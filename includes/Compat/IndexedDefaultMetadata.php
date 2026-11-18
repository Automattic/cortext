<?php
/**
 * Indexed replacement for core's default post meta lookup.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Compat;

defined( 'ABSPATH' ) || exit;

/**
 * Works around a core performance bug in `filter_default_metadata()`.
 *
 * Core runs that filter on every read of a meta key with no stored value, and
 * finds the key's default by walking every registered key of every subtype.
 * Cortext registers one `field-<id>` key per field on every document, so the
 * cost of reading a document's meta grows with the square of the number of
 * fields in the workspace.
 *
 * This class swaps core's callback on `default_post_metadata` for one that
 * returns the same value but looks the key up directly in each subtype.
 *
 * Limit: core hooks its callback again whenever a post meta key with a
 * `default` is registered. The swap runs at the end of `init` and of
 * `rest_api_init`. A key registered after that brings core's callback back.
 * Results stay identical, but reads go back to the slow path. The swap also
 * moves the callback to the end of priority 10, so a third-party callback at
 * that priority added after core's now runs before it.
 *
 * TODO: Link the Trac ticket once it is filed. Related: https://core.trac.wordpress.org/ticket/60787
 * TODO: Remove this class once the minimum supported WordPress version ships the core fix.
 */
final class IndexedDefaultMetadata {

	private const HOOK          = 'default_post_metadata';
	private const CORE_CALLBACK = 'filter_default_metadata';
	private const PRIORITY      = 10;

	public function register(): void {
		add_action( 'init', array( $this, 'swap' ), PHP_INT_MAX );
		add_action( 'rest_api_init', array( $this, 'swap' ), PHP_INT_MAX );
	}

	/**
	 * Replaces core's callback with the indexed one, at the same priority.
	 * Does nothing when core's callback is not hooked, which is the case when
	 * no post meta key has a registered default.
	 */
	public function swap(): void {
		if ( self::PRIORITY !== has_filter( self::HOOK, self::CORE_CALLBACK ) ) {
			return;
		}

		remove_filter( self::HOOK, self::CORE_CALLBACK, self::PRIORITY );
		add_filter( self::HOOK, array( $this, 'filter' ), self::PRIORITY, 5 );
	}

	/**
	 * Returns the registered default for a meta key, like core's
	 * `filter_default_metadata()`.
	 *
	 * @param mixed  $value     Current value passed to the filter.
	 * @param int    $object_id ID of the object the metadata is for.
	 * @param string $meta_key  Metadata key.
	 * @param bool   $single    Whether a single value was requested.
	 * @param string $meta_type Type of object the metadata is for.
	 * @return mixed The registered default, or `$value` when there is none.
	 */
	public function filter( $value, $object_id, $meta_key, $single, $meta_type ) {
		global $wp_meta_keys;

		if ( wp_installing() ) {
			return $value;
		}

		if ( ! is_array( $wp_meta_keys ) || ! isset( $wp_meta_keys[ $meta_type ] ) ) {
			return $value;
		}

		// Core compares the requested key to each registered key with `===`.
		// PHP stores integer-like string keys such as '123' as integers, so
		// core never matches them when the key is requested as a string.
		if ( ! is_int( $meta_key ) && ( ! is_string( $meta_key ) || (string) (int) $meta_key === $meta_key ) ) {
			return $value;
		}

		$defaults = array();
		foreach ( $wp_meta_keys[ $meta_type ] as $sub_type => $meta_data ) {
			if ( isset( $meta_data[ $meta_key ] ) && array_key_exists( 'default', $meta_data[ $meta_key ] ) ) {
				$defaults[ $sub_type ] = $meta_data[ $meta_key ];
			}
		}

		if ( ! $defaults ) {
			return $value;
		}

		// A default registered without a subtype is keyed as an empty string.
		if ( isset( $defaults[''] ) ) {
			$metadata = $defaults[''];
		} else {
			$sub_type = get_object_subtype( $meta_type, $object_id );
			if ( ! isset( $defaults[ $sub_type ] ) ) {
				return $value;
			}
			$metadata = $defaults[ $sub_type ];
		}

		if ( $single ) {
			return $metadata['default'];
		}

		return array( $metadata['default'] );
	}
}
