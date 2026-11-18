<?php
/**
 * Tests for Cortext\Compat\IndexedDefaultMetadata.
 *
 * Core's `filter_default_metadata()` is the oracle: the replacement has to
 * return exactly what core returns for the same arguments.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Compat\IndexedDefaultMetadata;
use WorDBless\BaseTestCase;

final class Test_Indexed_Default_Metadata extends BaseTestCase {

	private const HOOK          = 'default_post_metadata';
	private const DOCUMENT_TYPE = 'crtxt_document';
	private const OTHER_TYPE    = 'page';
	private const MISSING_ID    = 999999;

	/**
	 * Registered fixture keys as [ subtype, key ] pairs, for teardown.
	 *
	 * @var array<int, array{0:string,1:string}>
	 */
	private array $registered = array();

	private int $document_id = 0;

	private int $other_id = 0;

	public function set_up(): void {
		parent::set_up();

		remove_all_filters( self::HOOK );

		$this->register_key( self::DOCUMENT_TYPE, 'cx_own_default', array( 'default' => 'own' ) );
		$this->register_key( self::OTHER_TYPE, 'cx_other_default', array( 'default' => 'other' ) );
		$this->register_key( '', 'cx_global_default', array( 'default' => 'global' ) );
		$this->register_key( '', 'cx_global_wins', array( 'default' => 'global-wins' ) );
		$this->register_key( self::DOCUMENT_TYPE, 'cx_global_wins', array( 'default' => 'subtype-loses' ) );
		$this->register_key( self::DOCUMENT_TYPE, 'cx_both_subtypes', array( 'default' => 'document' ) );
		$this->register_key( self::OTHER_TYPE, 'cx_both_subtypes', array( 'default' => 'page' ) );
		$this->register_key( self::DOCUMENT_TYPE, 'cx_no_default', array() );
		$this->register_key( self::DOCUMENT_TYPE, 'cx_empty_default', array( 'default' => '' ) );
		$this->register_key(
			self::DOCUMENT_TYPE,
			'cx_zero_default',
			array(
				'type'    => 'integer',
				'default' => 0,
			)
		);
		$this->register_key(
			self::DOCUMENT_TYPE,
			'cx_object_default',
			array(
				'type'    => 'object',
				'default' => array( 'fields' => array() ),
			)
		);
		$this->register_key( self::DOCUMENT_TYPE, '123', array( 'default' => 'integer-like' ) );

		$this->document_id = (int) wp_insert_post(
			array(
				'post_type'   => self::DOCUMENT_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Document',
			)
		);
		$this->other_id    = (int) wp_insert_post(
			array(
				'post_type'   => self::OTHER_TYPE,
				'post_status' => 'publish',
				'post_title'  => 'Page',
			)
		);
	}

	public function tear_down(): void {
		wp_installing( false );

		foreach ( $this->registered as list( $subtype, $key ) ) {
			unregister_meta_key( 'post', $key, $subtype );
		}
		$this->registered = array();

		remove_all_filters( self::HOOK );

		parent::tear_down();
	}

	/**
	 * Registers a fixture key and remembers it for teardown.
	 *
	 * @param string              $subtype Post type, or '' for no subtype.
	 * @param string              $key     Meta key.
	 * @param array<string,mixed> $args    Extra registration args.
	 */
	private function register_key( string $subtype, string $key, array $args ): void {
		$args = array_merge(
			array(
				'type'           => 'string',
				'single'         => true,
				'object_subtype' => $subtype,
			),
			$args
		);

		$this->assertTrue( register_meta( 'post', $key, $args ), "Fixture key {$key} should register." );
		$this->registered[] = array( $subtype, $key );
	}

	private function object_id( string $target ): int {
		if ( 'document' === $target ) {
			return $this->document_id;
		}
		if ( 'other' === $target ) {
			return $this->other_id;
		}
		return self::MISSING_ID;
	}

	/**
	 * Every key on every kind of object, single and not, with the value
	 * `get_metadata_default()` passes in and with a value another filter set.
	 *
	 * @return array<string, array{0:string,1:string|int,2:bool,3:mixed}>
	 */
	public function provide_lookups(): array {
		$keys = array(
			'default on the own subtype'      => 'cx_own_default',
			'default only on another subtype' => 'cx_other_default',
			'default with no subtype'         => 'cx_global_default',
			'no subtype wins over subtype'    => 'cx_global_wins',
			'default on two subtypes'         => 'cx_both_subtypes',
			'registered without a default'    => 'cx_no_default',
			'empty string default'            => 'cx_empty_default',
			'zero default'                    => 'cx_zero_default',
			'object default'                  => 'cx_object_default',
			'integer-like key as a string'    => '123',
			'integer-like key as an integer'  => 123,
			'unregistered key'                => 'cx_unregistered',
			'empty key'                       => '',
		);

		$cases = array();
		foreach ( $keys as $label => $key ) {
			foreach ( array( 'document', 'other', 'missing' ) as $object ) {
				foreach ( array( true, false ) as $single ) {
					$shape                                    = $single ? 'single' : 'multiple';
					$initial                                  = $single ? '' : array();
					$cases[ "{$label}, {$object}, {$shape}" ] = array( $object, $key, $single, $initial );
					$cases[ "{$label}, {$object}, {$shape}, set" ] = array( $object, $key, $single, 'already-set' );
				}
			}
		}

		return $cases;
	}

	/**
	 * The replacement returns what core returns.
	 *
	 * @dataProvider provide_lookups
	 *
	 * @param string     $target   Which fixture object to read.
	 * @param string|int $meta_key Meta key.
	 * @param bool       $single   Whether a single value is requested.
	 * @param mixed      $value    Value passed into the filter.
	 */
	public function test_filter_matches_core( string $target, $meta_key, bool $single, $value ): void {
		$object_id = $this->object_id( $target );

		$this->assertSame(
			filter_default_metadata( $value, $object_id, $meta_key, $single, 'post' ),
			( new IndexedDefaultMetadata() )->filter( $value, $object_id, $meta_key, $single, 'post' )
		);
	}

	/**
	 * Both return the incoming value while WordPress is installing.
	 *
	 * @dataProvider provide_lookups
	 *
	 * @param string     $target   Which fixture object to read.
	 * @param string|int $meta_key Meta key.
	 * @param bool       $single   Whether a single value is requested.
	 * @param mixed      $value    Value passed into the filter.
	 */
	public function test_filter_matches_core_while_installing( string $target, $meta_key, bool $single, $value ): void {
		$object_id = $this->object_id( $target );
		wp_installing( true );

		$expected = filter_default_metadata( $value, $object_id, $meta_key, $single, 'post' );
		$actual   = ( new IndexedDefaultMetadata() )->filter( $value, $object_id, $meta_key, $single, 'post' );

		$this->assertSame( $value, $expected, 'Core returns the value untouched while installing.' );
		$this->assertSame( $expected, $actual );
	}

	public function test_filter_matches_core_for_other_meta_types(): void {
		$sut = new IndexedDefaultMetadata();

		foreach ( array( 'term', 'not_a_meta_type' ) as $meta_type ) {
			$this->assertSame(
				filter_default_metadata( '', 1, 'cx_own_default', true, $meta_type ),
				$sut->filter( '', 1, 'cx_own_default', true, $meta_type )
			);
		}
	}

	public function test_fixture_exercises_the_default_paths(): void {
		$sut = new IndexedDefaultMetadata();

		$this->assertSame( 'own', $sut->filter( '', $this->document_id, 'cx_own_default', true, 'post' ) );
		$this->assertSame( array( 'own' ), $sut->filter( array(), $this->document_id, 'cx_own_default', false, 'post' ) );
		$this->assertSame( '', $sut->filter( '', $this->document_id, 'cx_other_default', true, 'post' ) );
		$this->assertSame( 'global', $sut->filter( '', $this->other_id, 'cx_global_default', true, 'post' ) );
		$this->assertSame( 'global-wins', $sut->filter( '', $this->document_id, 'cx_global_wins', true, 'post' ) );
		$this->assertSame( 'page', $sut->filter( '', $this->other_id, 'cx_both_subtypes', true, 'post' ) );
		$this->assertSame( 0, $sut->filter( '', $this->document_id, 'cx_zero_default', true, 'post' ) );
	}

	public function test_register_swaps_at_the_end_of_init_and_rest_api_init(): void {
		$sut = new IndexedDefaultMetadata();
		$sut->register();

		$this->assertSame( PHP_INT_MAX, has_action( 'init', array( $sut, 'swap' ) ) );
		$this->assertSame( PHP_INT_MAX, has_action( 'rest_api_init', array( $sut, 'swap' ) ) );

		remove_action( 'init', array( $sut, 'swap' ), PHP_INT_MAX );
		remove_action( 'rest_api_init', array( $sut, 'swap' ), PHP_INT_MAX );
	}

	public function test_swap_replaces_core_callback_at_the_same_priority(): void {
		$this->assertSame( 10, has_filter( self::HOOK, 'filter_default_metadata' ), 'Registering a default hooks core.' );

		$sut = new IndexedDefaultMetadata();
		$sut->swap();

		$this->assertFalse( has_filter( self::HOOK, 'filter_default_metadata' ) );
		$this->assertSame( 10, has_filter( self::HOOK, array( $sut, 'filter' ) ) );
	}

	public function test_swap_does_nothing_when_core_is_not_hooked(): void {
		remove_all_filters( self::HOOK );

		( new IndexedDefaultMetadata() )->swap();

		$this->assertFalse( has_filter( self::HOOK ) );
	}

	public function test_swap_again_after_a_late_registration(): void {
		global $wp_filter;

		$sut = new IndexedDefaultMetadata();
		$sut->swap();

		$this->register_key( self::DOCUMENT_TYPE, 'cx_late_default', array( 'default' => 'late' ) );
		$this->assertSame( 10, has_filter( self::HOOK, 'filter_default_metadata' ), 'A late default hooks core again.' );

		$sut->swap();

		$this->assertFalse( has_filter( self::HOOK, 'filter_default_metadata' ) );
		$this->assertCount( 1, $wp_filter[ self::HOOK ]->callbacks[10] );
		$this->assertSame( 'late', get_post_meta( $this->document_id, 'cx_late_default', true ) );
	}

	public function test_get_post_meta_is_unchanged_by_the_swap(): void {
		update_post_meta( $this->document_id, 'cx_own_default', 'stored' );
		update_post_meta( $this->document_id, 'cx_no_default', 'stored too' );

		$read = function (): array {
			$values = array();
			foreach ( array( $this->document_id, $this->other_id ) as $object_id ) {
				foreach ( $this->registered as list( , $key ) ) {
					$values[] = get_post_meta( $object_id, $key, true );
					$values[] = get_post_meta( $object_id, $key, false );
				}
				$values[] = get_post_meta( $object_id, 'cx_unregistered', true );
				$values[] = get_post_meta( $object_id, 'cx_unregistered', false );
			}
			return $values;
		};

		$with_core = $read();
		( new IndexedDefaultMetadata() )->swap();

		$this->assertFalse( has_filter( self::HOOK, 'filter_default_metadata' ) );
		$this->assertSame( $with_core, $read() );
		$this->assertSame( 'stored', get_post_meta( $this->document_id, 'cx_own_default', true ) );
		$this->assertSame( '', get_post_meta( $this->other_id, 'cx_own_default', true ) );
		$this->assertSame( 'global', get_post_meta( $this->document_id, 'cx_global_default', true ) );
	}
}
