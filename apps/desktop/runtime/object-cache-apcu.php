<?php
/**
 * Cortext Desktop APCu object-cache exploration drop-in.
 *
 * This file is copied into wp-content/object-cache.php only when the Desktop
 * runtime starts with CORTEXT_DESKTOP_OBJECT_CACHE=apcu.
 *
 * @package Cortext
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

function wp_cache_init() {
	$GLOBALS['wp_object_cache'] = new Cortext_Desktop_APCu_Object_Cache();
}

function wp_cache_add( $key, $data, $group = '', $expire = 0 ) {
	global $wp_object_cache;
	return $wp_object_cache->add( $key, $data, $group, (int) $expire );
}

function wp_cache_add_multiple( array $data, $group = '', $expire = 0 ) {
	global $wp_object_cache;
	return $wp_object_cache->add_multiple( $data, $group, (int) $expire );
}

function wp_cache_replace( $key, $data, $group = '', $expire = 0 ) {
	global $wp_object_cache;
	return $wp_object_cache->replace( $key, $data, $group, (int) $expire );
}

function wp_cache_set( $key, $data, $group = '', $expire = 0 ) {
	global $wp_object_cache;
	return $wp_object_cache->set( $key, $data, $group, (int) $expire );
}

function wp_cache_set_multiple( array $data, $group = '', $expire = 0 ) {
	global $wp_object_cache;
	return $wp_object_cache->set_multiple( $data, $group, (int) $expire );
}

function wp_cache_get( $key, $group = '', $force = false, &$found = null ) {
	global $wp_object_cache;
	return $wp_object_cache->get( $key, $group, $force, $found );
}

function wp_cache_get_multiple( $keys, $group = '', $force = false ) {
	global $wp_object_cache;
	return $wp_object_cache->get_multiple( $keys, $group, $force );
}

function wp_cache_delete( $key, $group = '' ) {
	global $wp_object_cache;
	return $wp_object_cache->delete( $key, $group );
}

function wp_cache_delete_multiple( array $keys, $group = '' ) {
	global $wp_object_cache;
	return $wp_object_cache->delete_multiple( $keys, $group );
}

function wp_cache_incr( $key, $offset = 1, $group = '' ) {
	global $wp_object_cache;
	return $wp_object_cache->incr( $key, $offset, $group );
}

function wp_cache_decr( $key, $offset = 1, $group = '' ) {
	global $wp_object_cache;
	return $wp_object_cache->decr( $key, $offset, $group );
}

function wp_cache_flush() {
	global $wp_object_cache;
	return $wp_object_cache->flush();
}

function wp_cache_flush_runtime() {
	global $wp_object_cache;
	return $wp_object_cache->flush_runtime();
}

function wp_cache_flush_group( $group ) {
	global $wp_object_cache;
	return $wp_object_cache->flush_group( $group );
}

function wp_cache_supports( $feature ) {
	global $wp_object_cache;
	return is_object( $wp_object_cache ) && $wp_object_cache->supports( $feature );
}

function wp_cache_close() {
	return true;
}

function wp_cache_add_global_groups( $groups ) {
	global $wp_object_cache;
	$wp_object_cache->add_global_groups( $groups );
}

function wp_cache_add_non_persistent_groups( $groups ) {
	global $wp_object_cache;
	$wp_object_cache->add_non_persistent_groups( $groups );
}

function wp_cache_switch_to_blog( $blog_id ) {
	global $wp_object_cache;
	$wp_object_cache->switch_to_blog( $blog_id );
}

function wp_cache_reset() {
	global $wp_object_cache;
	return $wp_object_cache->reset();
}

#[AllowDynamicProperties]
class Cortext_Desktop_APCu_Object_Cache {
	private array $cache = array();
	private array $global_groups = array();
	private array $non_persistent_groups = array();
	private string $blog_prefix = '';
	private string $key_salt = '';
	private bool $multisite = false;
	private bool $apcu_available = false;

	public int $cache_hits = 0;
	public int $cache_misses = 0;
	private int $apcu_hits = 0;
	private int $apcu_misses = 0;
	private int $apcu_sets = 0;
	private int $apcu_deletes = 0;

	public function __construct() {
		$this->multisite      = function_exists( 'is_multisite' ) && is_multisite();
		$this->blog_prefix    = $this->multisite && function_exists( 'get_current_blog_id' )
			? get_current_blog_id() . ':'
			: '';
		$this->key_salt       = 'cortext-desktop:' . md5( ABSPATH ) . ':';
		$this->apcu_available = function_exists( 'apcu_fetch' )
			&& function_exists( 'apcu_store' )
			&& filter_var( ini_get( 'apc.enabled' ), FILTER_VALIDATE_BOOLEAN );
	}

	public function __get( $name ) {
		return $this->$name;
	}

	public function __set( $name, $value ): void {
		$this->$name = $value;
	}

	public function __isset( $name ): bool {
		return isset( $this->$name );
	}

	public function __unset( $name ): void {
		unset( $this->$name );
	}

	public function add( $key, $data, $group = 'default', $expire = 0 ): bool {
		if ( function_exists( 'wp_suspend_cache_addition' ) && wp_suspend_cache_addition() ) {
			return false;
		}

		$prepared = $this->prepare_key( $key, $group );
		if ( ! $prepared ) {
			return false;
		}

		list( $id, $group ) = $prepared;

		if ( $this->exists_local( $id, $group ) ) {
			return false;
		}

		if ( $this->is_persistent_group( $group ) && $this->apcu_available ) {
			$stored = apcu_add( $this->apcu_key( $id, $group ), $this->clone_for_storage( $data ), max( 0, (int) $expire ) );
			if ( ! $stored ) {
				return false;
			}
			++$this->apcu_sets;
		}

		$this->cache[ $group ][ $id ] = $this->clone_for_storage( $data );
		return true;
	}

	public function add_multiple( array $data, $group = '', $expire = 0 ): array {
		$values = array();
		foreach ( $data as $key => $value ) {
			$values[ $key ] = $this->add( $key, $value, $group, $expire );
		}
		return $values;
	}

	public function replace( $key, $data, $group = 'default', $expire = 0 ): bool {
		$found = false;
		$this->get( $key, $group, true, $found );
		if ( ! $found ) {
			return false;
		}
		return $this->set( $key, $data, $group, $expire );
	}

	public function set( $key, $data, $group = 'default', $expire = 0 ): bool {
		$prepared = $this->prepare_key( $key, $group );
		if ( ! $prepared ) {
			return false;
		}

		list( $id, $group ) = $prepared;
		$value              = $this->clone_for_storage( $data );

		if ( $this->is_persistent_group( $group ) && $this->apcu_available ) {
			if ( apcu_store( $this->apcu_key( $id, $group ), $value, max( 0, (int) $expire ) ) ) {
				++$this->apcu_sets;
			}
		}

		$this->cache[ $group ][ $id ] = $value;
		return true;
	}

	public function set_multiple( array $data, $group = '', $expire = 0 ): array {
		$values = array();
		foreach ( $data as $key => $value ) {
			$values[ $key ] = $this->set( $key, $value, $group, $expire );
		}
		return $values;
	}

	public function get( $key, $group = 'default', $force = false, &$found = null ) {
		$prepared = $this->prepare_key( $key, $group );
		if ( ! $prepared ) {
			$found = false;
			return false;
		}

		list( $id, $group ) = $prepared;

		$can_force_persistent = $force && $this->is_persistent_group( $group ) && $this->apcu_available;
		if ( ! $can_force_persistent && $this->exists_local( $id, $group ) ) {
			$found = true;
			++$this->cache_hits;
			return $this->clone_for_return( $this->cache[ $group ][ $id ] );
		}

		if ( $this->is_persistent_group( $group ) && $this->apcu_available ) {
			$success = false;
			$value   = apcu_fetch( $this->apcu_key( $id, $group ), $success );
			if ( $success ) {
				$found                       = true;
				$this->cache[ $group ][ $id ] = $value;
				++$this->cache_hits;
				++$this->apcu_hits;
				return $this->clone_for_return( $value );
			}
			++$this->apcu_misses;
		}

		$found = false;
		++$this->cache_misses;
		return false;
	}

	public function get_multiple( $keys, $group = 'default', $force = false ): array {
		$values = array();
		foreach ( $keys as $key ) {
			$values[ $key ] = $this->get( $key, $group, $force );
		}
		return $values;
	}

	public function delete( $key, $group = 'default' ): bool {
		$prepared = $this->prepare_key( $key, $group );
		if ( ! $prepared ) {
			return false;
		}

		list( $id, $group ) = $prepared;
		$deleted            = false;

		if ( $this->exists_local( $id, $group ) ) {
			unset( $this->cache[ $group ][ $id ] );
			$deleted = true;
		}

		if ( $this->is_persistent_group( $group ) && $this->apcu_available ) {
			$deleted = apcu_delete( $this->apcu_key( $id, $group ) ) || $deleted;
			++$this->apcu_deletes;
		}

		return $deleted;
	}

	public function delete_multiple( array $keys, $group = '' ): array {
		$values = array();
		foreach ( $keys as $key ) {
			$values[ $key ] = $this->delete( $key, $group );
		}
		return $values;
	}

	public function incr( $key, $offset = 1, $group = 'default' ) {
		return $this->change_counter( $key, (int) $offset, $group );
	}

	public function decr( $key, $offset = 1, $group = 'default' ) {
		return $this->change_counter( $key, -1 * (int) $offset, $group );
	}

	public function flush(): bool {
		$this->cache = array();
		if ( $this->apcu_available ) {
			return apcu_clear_cache();
		}
		return true;
	}

	public function flush_runtime(): bool {
		$this->cache = array();
		return true;
	}

	public function flush_group( $group ): bool {
		$group = $this->normalize_group( $group );
		unset( $this->cache[ $group ] );

		if ( ! $this->apcu_available || ! class_exists( 'APCUIterator' ) ) {
			return true;
		}

		foreach ( new APCUIterator( '/^' . preg_quote( $this->key_salt . $group . ':', '/' ) . '/' ) as $item ) {
			if ( isset( $item['key'] ) ) {
				apcu_delete( $item['key'] );
			}
		}

		return true;
	}

	public function supports( $feature ): bool {
		return in_array(
			$feature,
			array( 'add_multiple', 'set_multiple', 'get_multiple', 'delete_multiple', 'flush_runtime', 'flush_group' ),
			true
		);
	}

	public function add_global_groups( $groups ): void {
		foreach ( (array) $groups as $group ) {
			$this->global_groups[ (string) $group ] = true;
		}
	}

	public function add_non_persistent_groups( $groups ): void {
		foreach ( (array) $groups as $group ) {
			$this->non_persistent_groups[ (string) $group ] = true;
		}
	}

	public function switch_to_blog( $blog_id ): void {
		$this->blog_prefix = $this->multisite ? (int) $blog_id . ':' : '';
	}

	public function reset(): bool {
		foreach ( array_keys( $this->cache ) as $group ) {
			if ( ! isset( $this->global_groups[ $group ] ) ) {
				unset( $this->cache[ $group ] );
			}
		}
		return true;
	}

	public function cortext_stats(): array {
		return array(
			'apcu_available'        => $this->apcu_available,
			'cache_hits'            => $this->cache_hits,
			'cache_misses'          => $this->cache_misses,
			'apcu_hits'             => $this->apcu_hits,
			'apcu_misses'           => $this->apcu_misses,
			'apcu_sets'             => $this->apcu_sets,
			'apcu_deletes'          => $this->apcu_deletes,
			'groups_in_runtime'     => count( $this->cache ),
			'non_persistent_groups' => array_keys( $this->non_persistent_groups ),
		);
	}

	private function prepare_key( $key, $group ): array|false {
		if ( ! is_int( $key ) && ( ! is_string( $key ) || trim( $key ) === '' ) ) {
			return false;
		}

		$group = $this->normalize_group( $group );
		$id    = (string) $key;

		if ( $this->multisite && ! isset( $this->global_groups[ $group ] ) ) {
			$id = $this->blog_prefix . $id;
		}

		return array( $id, $group );
	}

	private function normalize_group( $group ): string {
		$group = (string) $group;
		return $group === '' ? 'default' : $group;
	}

	private function is_persistent_group( string $group ): bool {
		return ! isset( $this->non_persistent_groups[ $group ] );
	}

	private function exists_local( string $id, string $group ): bool {
		return isset( $this->cache[ $group ] )
			&& ( isset( $this->cache[ $group ][ $id ] ) || array_key_exists( $id, $this->cache[ $group ] ) );
	}

	private function change_counter( $key, int $offset, $group = 'default' ) {
		$prepared = $this->prepare_key( $key, $group );
		if ( ! $prepared ) {
			return false;
		}

		list( $id, $group ) = $prepared;

		if ( $this->is_persistent_group( $group ) && $this->apcu_available && function_exists( 'apcu_cas' ) ) {
			return $this->change_persistent_counter( $id, $group, $offset );
		}

		return $this->change_local_counter( $id, $group, $offset );
	}

	private function change_local_counter( string $id, string $group, int $offset ) {
		if ( ! $this->exists_local( $id, $group ) ) {
			return false;
		}

		$value                       = $this->cache[ $group ][ $id ];
		$value                       = is_numeric( $value ) ? (int) $value : 0;
		$value                       = max( 0, $value + $offset );
		$this->cache[ $group ][ $id ] = $value;
		return $value;
	}

	private function change_persistent_counter( string $id, string $group, int $offset ) {
		$apcu_key = $this->apcu_key( $id, $group );

		for ( $attempt = 0; $attempt < 50; ++$attempt ) {
			$found = false;
			$value = apcu_fetch( $apcu_key, $found );
			if ( ! $found ) {
				unset( $this->cache[ $group ][ $id ] );
				return false;
			}

			$current = is_numeric( $value ) ? (int) $value : 0;
			$next    = max( 0, $current + $offset );

			if ( ! is_int( $value ) ) {
				if ( ! apcu_store( $apcu_key, $next ) ) {
					return false;
				}
				$this->cache[ $group ][ $id ] = $next;
				++$this->cache_hits;
				++$this->apcu_hits;
				++$this->apcu_sets;
				return $next;
			}

			if ( apcu_cas( $apcu_key, $current, $next ) ) {
				$this->cache[ $group ][ $id ] = $next;
				++$this->cache_hits;
				++$this->apcu_hits;
				++$this->apcu_sets;
				return $next;
			}
		}

		return false;
	}

	private function apcu_key( string $id, string $group ): string {
		return $this->key_salt . $group . ':' . md5( $id );
	}

	private function clone_for_storage( $value ) {
		return is_object( $value ) ? clone $value : $value;
	}

	private function clone_for_return( $value ) {
		return is_object( $value ) ? clone $value : $value;
	}
}
