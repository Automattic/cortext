<?php
/**
 * Derived field-value index for collection rows.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\FieldValues;

defined( 'ABSPATH' ) || exit;

use Cortext\Fields\FieldTypeRegistry;
use Cortext\PostType\Document;
use Cortext\PostType\Field;
use Cortext\Taxonomy\TraitTaxonomy;
use Cortext\Relations;
use RuntimeException;
use WP_Post;
use WP_Query;

final class FieldValueIndex {

	public const STATUS_UNAVAILABLE = 'unavailable';
	public const STATUS_INSTALLING  = 'installing';
	public const STATUS_SYNCING     = 'syncing';
	public const STATUS_READY       = 'ready';
	public const STATUS_STALE       = 'stale';
	public const STATUS_DISABLED    = 'disabled';

	private const SCHEMA_VERSION         = 2;
	private const STATUS_OPTION          = 'cortext_field_values_index_status';
	private const STATUS_ERROR_OPTION    = 'cortext_field_values_index_error';
	private const SCHEMA_VERSION_OPTION  = 'cortext_field_values_schema_version';
	private const ENABLED_OPTION         = 'cortext_field_values_index_enabled';
	private const DISABLED_SINCE_OPTION  = 'cortext_field_values_disabled_since';
	private const INSTALL_ATTEMPT_OPTION = 'cortext_field_values_install_attempted_version';
	private const AUTO_REBUILD_HOOK      = 'cortext_field_values_auto_rebuild';
	private const AUTO_REBUILD_LOCK      = 'cortext_field_values_auto_rebuild_lock';
	private const TEXT_INDEX_LENGTH      = 191;
	private const PAGE_SIZE              = 500;

	private static int $sync_suspensions             = 0;
	private static array $table_exists_cache         = array();
	private static array $pending_row_fields         = array();
	private static array $collection_id_by_row_cache = array();

	public function register(): void {
		add_action( 'added_post_meta', array( $this, 'sync_meta_change' ), 10, 4 );
		add_action( 'updated_post_meta', array( $this, 'sync_meta_change' ), 10, 4 );
		add_action( 'deleted_post_meta', array( $this, 'sync_meta_change' ), 10, 4 );
		add_action( 'wp_trash_post', array( $this, 'sync_row_status' ), 20, 1 );
		add_action( 'untrashed_post', array( $this, 'sync_row_status' ), 20, 1 );
		add_action( 'before_delete_post', array( $this, 'cleanup_deleted_post' ), 20, 2 );
		// Invalidate the row->collection cache when a document's trait
		// membership changes, so the next meta sync resolves the new trait.
		add_action( 'set_object_terms', array( $this, 'invalidate_collection_cache_for_row' ), 10, 4 );
		add_action( 'init', array( $this, 'maybe_auto_provision' ), 30 );
		add_action( 'shutdown', array( $this, 'flush_pending_sync' ), 1 );
		add_action( self::AUTO_REBUILD_HOOK, array( $this, 'run_auto_rebuild' ) );
	}

	public static function suspend_sync(): void {
		++self::$sync_suspensions;
	}

	public static function resume_sync(): void {
		self::$sync_suspensions = max( 0, self::$sync_suspensions - 1 );
	}

	public static function sync_is_suspended(): bool {
		return self::$sync_suspensions > 0;
	}

	public static function flush_runtime_caches(): void {
		self::$table_exists_cache         = array();
		self::$pending_row_fields         = array();
		self::$collection_id_by_row_cache = array();
	}

	/**
	 * Invalidates the cached row->collection mapping when a document's
	 * `crtxt_trait` term assignment changes. Hooked on
	 * `set_object_terms` so subsequent meta syncs resolve the new trait.
	 *
	 * @param int    $object_id Document post id whose terms changed.
	 * @param mixed  $terms     New terms (unused).
	 * @param mixed  $tt_ids    New term_taxonomy ids (unused).
	 * @param string $taxonomy  Taxonomy that was set.
	 */
	public function invalidate_collection_cache_for_row( int $object_id, $terms, $tt_ids, string $taxonomy ): void {
		unset( $terms, $tt_ids );
		if ( TraitTaxonomy::TAXONOMY !== $taxonomy ) {
			return;
		}
		unset( self::$collection_id_by_row_cache[ $object_id ] );
	}

	public function table_name(): string {
		global $wpdb;
		return $wpdb->prefix . 'cortext_field_values';
	}

	public function status(): array {
		$enabled = $this->is_enabled();
		return array(
			'enabled'                 => $enabled,
			'status'                  => $enabled ? (string) get_option( self::STATUS_OPTION, self::STATUS_UNAVAILABLE ) : self::STATUS_DISABLED,
			'error'                   => (string) get_option( self::STATUS_ERROR_OPTION, '' ),
			'schemaVersion'           => (int) get_option( self::SCHEMA_VERSION_OPTION, 0 ),
			'disabledSince'           => (int) get_option( self::DISABLED_SINCE_OPTION, 0 ),
			'installAttemptedVersion' => (int) get_option( self::INSTALL_ATTEMPT_OPTION, 0 ),
			'table'                   => $this->table_name(),
			'tableExists'             => $this->table_exists(),
			'autoRebuildScheduled'    => false !== wp_next_scheduled( self::AUTO_REBUILD_HOOK ),
		);
	}

	public function install(): bool {
		if ( ! $this->is_enabled() ) {
			return false;
		}

		update_option( self::INSTALL_ATTEMPT_OPTION, self::SCHEMA_VERSION, false );
		$this->set_status( self::STATUS_INSTALLING );

		$created = $this->create_table();
		if ( ! $created || ! $this->table_exists() ) {
			$this->set_status(
				self::STATUS_UNAVAILABLE,
				__( 'Cortext could not create the field-value index table.', 'cortext' )
			);
			return false;
		}

		update_option( self::SCHEMA_VERSION_OPTION, self::SCHEMA_VERSION, false );
		if ( self::STATUS_READY !== (string) get_option( self::STATUS_OPTION, '' ) ) {
			$this->set_status( self::STATUS_STALE );
		}
		return true;
	}

	public function activate(): void {
		if ( ! $this->is_enabled() ) {
			$this->record_disabled_state();
			return;
		}

		if ( $this->install() ) {
			$this->schedule_auto_rebuild();
		}
	}

	public function maybe_auto_provision(): void {
		if ( wp_installing() ) {
			return;
		}

		if ( ! $this->is_enabled() ) {
			$this->record_disabled_state();
			return;
		}

		$was_disabled = (int) get_option( self::DISABLED_SINCE_OPTION, 0 ) > 0;
		if ( $this->schema_is_current() && $this->table_exists() ) {
			if ( $was_disabled ) {
				$this->mark_stale( __( 'The field-value index was re-enabled and needs a rebuild.', 'cortext' ) );
				$this->schedule_auto_rebuild();
			} elseif ( ! $this->can_read() ) {
				$this->schedule_auto_rebuild();
			}
			return;
		}

		$already_tried_current_schema = (int) get_option( self::INSTALL_ATTEMPT_OPTION, 0 ) === self::SCHEMA_VERSION;
		if ( $already_tried_current_schema && ! $this->schema_is_current() ) {
			return;
		}

		if ( $this->install() ) {
			$this->schedule_auto_rebuild();
		}
	}

	public function run_auto_rebuild(): void {
		if ( ! $this->is_enabled() ) {
			return;
		}

		if ( ! $this->claim_auto_rebuild_lock() ) {
			$this->schedule_auto_rebuild( 5 * MINUTE_IN_SECONDS );
			return;
		}

		try {
			if ( ! $this->install() ) {
				return;
			}

			$collection_ids = $this->collection_ids();
			foreach ( $collection_ids as $collection_id ) {
				$this->rebuild_collection( $collection_id );
			}

			$failed = array();
			foreach ( $collection_ids as $collection_id ) {
				$result = $this->verify_collection( $collection_id );
				if ( empty( $result['passed'] ) ) {
					$failed[] = $collection_id;
				}
			}

			if ( count( $failed ) > 0 ) {
				$this->mark_stale(
					sprintf(
						/* translators: %s: comma-separated collection IDs */
						__( 'Field-value index verification failed for collections: %s.', 'cortext' ),
						implode( ', ', $failed )
					)
				);
				return;
			}

			$this->set_status( self::STATUS_READY );
			delete_option( self::DISABLED_SINCE_OPTION );
		} catch ( RuntimeException $exception ) {
			$this->mark_stale( $exception->getMessage() );
		} finally {
			delete_option( self::AUTO_REBUILD_LOCK );
		}
	}

	public function can_read(): bool {
		return $this->is_enabled()
			&& self::STATUS_READY === (string) get_option( self::STATUS_OPTION, self::STATUS_UNAVAILABLE )
			&& (int) get_option( self::SCHEMA_VERSION_OPTION, 0 ) === self::SCHEMA_VERSION
			&& $this->table_exists();
	}

	public function can_write(): bool {
		return $this->is_enabled()
			&& self::STATUS_UNAVAILABLE !== (string) get_option( self::STATUS_OPTION, self::STATUS_UNAVAILABLE )
			&& (int) get_option( self::SCHEMA_VERSION_OPTION, 0 ) === self::SCHEMA_VERSION
			&& $this->table_exists();
	}

	public function is_enabled(): bool {
		$value = get_option( self::ENABLED_OPTION, true );
		if ( is_bool( $value ) ) {
			$enabled = $value;
		} elseif ( is_numeric( $value ) ) {
			$enabled = 0 !== (int) $value;
		} else {
			$enabled = ! in_array(
				strtolower( trim( (string) $value ) ),
				array( '0', 'false', 'no', 'off', 'disabled' ),
				true
			);
		}

		/**
		 * Controls whether the derived field-value index can install, rebuild,
		 * sync, or answer reads.
		 *
		 * Returning false leaves postmeta as the only active store for field values.
		 *
		 * @param bool $enabled Whether the index is enabled.
		 */
		return (bool) apply_filters( 'cortext_field_values_index_enabled', $enabled );
	}

	public function mark_stale( string $reason = '' ): void {
		$this->set_status( self::STATUS_STALE, $reason );
	}

	public function rebuild_collection( int $collection_id ): array {
		if ( ! $this->install() ) {
			return array(
				'indexedRows' => 0,
				'valueRows'   => 0,
				'status'      => $this->is_enabled() ? self::STATUS_UNAVAILABLE : self::STATUS_DISABLED,
			);
		}

		$term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			throw new RuntimeException( esc_html__( 'Collection mirror term is not registered.', 'cortext' ) );
		}

		$field_ids = array_values( array_filter( array_map( 'intval', get_post_meta( $collection_id, 'cortext_fields', false ) ) ) );
		$this->set_status( self::STATUS_SYNCING );
		$this->delete_collection( $collection_id );

		$value_rows   = 0;
		$indexed_rows = 0;
		$page         = 1;

		do {
			$query = new WP_Query(
				array(
					'post_type'      => Document::POST_TYPE,
					'post_status'    => array( 'draft', 'private', 'publish', 'trash' ),
					'fields'         => 'ids',
					'posts_per_page' => self::PAGE_SIZE,
					'paged'          => $page,
					'orderby'        => 'ID',
					'order'          => 'ASC',
					'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
						array(
							'taxonomy' => TraitTaxonomy::TAXONOMY,
							'field'    => 'term_id',
							'terms'    => array( $term_id ),
						),
					),
				)
			);

			$row_ids = array_map( 'intval', $query->posts );
			foreach ( $row_ids as $row_id ) {
				++$indexed_rows;
				foreach ( $field_ids as $field_id ) {
					$value_rows += $this->index_row_field( $row_id, $field_id, $collection_id, false );
				}
			}

			++$page;
		} while ( $page <= (int) $query->max_num_pages );

		$this->set_status( self::STATUS_READY );
		delete_option( self::DISABLED_SINCE_OPTION );

		return array(
			'indexedRows' => $indexed_rows,
			'valueRows'   => $value_rows,
			'status'      => self::STATUS_READY,
		);
	}

	public function verify_collection( int $collection_id ): array {
		if ( ! $this->is_enabled() || ! $this->table_exists() ) {
			return array(
				'collectionId' => $collection_id,
				'expectedRows' => 0,
				'actualRows'   => 0,
				'missing'      => 0,
				'extra'        => 0,
				'passed'       => false,
			);
		}

		$term_id = Relations::trait_term_id_for_collection( $collection_id );
		if ( $term_id < 1 ) {
			throw new RuntimeException( esc_html__( 'Collection mirror term is not registered.', 'cortext' ) );
		}

		$field_ids = array_values( array_filter( array_map( 'intval', get_post_meta( $collection_id, 'cortext_fields', false ) ) ) );
		$expected  = array();
		$page      = 1;

		do {
			$query = new WP_Query(
				array(
					'post_type'      => Document::POST_TYPE,
					'post_status'    => array( 'draft', 'private', 'publish', 'trash' ),
					'fields'         => 'ids',
					'posts_per_page' => self::PAGE_SIZE,
					'paged'          => $page,
					'orderby'        => 'ID',
					'order'          => 'ASC',
					'tax_query'      => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query
						array(
							'taxonomy' => TraitTaxonomy::TAXONOMY,
							'field'    => 'term_id',
							'terms'    => array( $term_id ),
						),
					),
				)
			);

			foreach ( array_map( 'intval', $query->posts ) as $row_id ) {
				foreach ( $field_ids as $field_id ) {
					foreach ( $this->index_rows_for_row_field( $row_id, $field_id, $collection_id ) as $row ) {
						$expected[ $this->signature( $row ) ] = true;
					}
				}
			}

			++$page;
		} while ( $page <= (int) $query->max_num_pages );

		$actual = array();
		foreach ( $this->indexed_rows_for_collection( $collection_id ) as $row ) {
			$actual[ $this->signature( $row ) ] = true;
		}

		$missing = array_diff_key( $expected, $actual );
		$extra   = array_diff_key( $actual, $expected );

		return array(
			'collectionId' => $collection_id,
			'expectedRows' => count( $expected ),
			'actualRows'   => count( $actual ),
			'missing'      => count( $missing ),
			'extra'        => count( $extra ),
			'passed'       => count( $missing ) === 0 && count( $extra ) === 0,
		);
	}

	public function index_row_field( int $row_id, int $field_id, ?int $collection_id = null, bool $delete_existing = true ): int {
		if ( ! $this->can_write() ) {
			return 0;
		}

		$collection_id = $collection_id ?? $this->collection_id_for_row( $row_id );
		if ( $collection_id < 1 ) {
			return 0;
		}

		$rows = $this->index_rows_for_row_field( $row_id, $field_id, $collection_id );
		return $this->write_index_rows( $row_id, $field_id, $rows, $delete_existing, $this->field_can_have_multiple_values( $field_id ) );
	}

	public function index_known_value( int $row_id, int $field_id, string $field_type, mixed $value, ?int $collection_id = null, ?string $post_status = null ): int {
		if ( ! $this->can_write() || '' === $field_type || 'rollup' === $field_type ) {
			return 0;
		}

		$collection_id = $collection_id ?? $this->collection_id_for_row( $row_id );
		if ( $collection_id < 1 ) {
			return 0;
		}

		$post_status = $post_status ?? (string) get_post_status( $row_id );
		$rows        = array();
		foreach ( $this->normalized_value_rows( $field_id, $field_type, $value, $post_status ) as $row ) {
			$rows[] = array(
				'row_id'            => $row_id,
				'collection_id'     => $collection_id,
				'field_id'          => $row['field_id'],
				'value_seq'         => $row['value_seq'],
				'value_text'        => $row['value_text'],
				'value_text_length' => $row['value_text_length'],
				'value_number'      => $row['value_number'],
				'value_date'        => $row['value_date'],
				'post_status'       => $row['post_status'],
			);
		}

		return $this->write_index_rows( $row_id, $field_id, $rows, true, $this->known_type_can_have_multiple_values( $field_id, $field_type ) );
	}

	private function write_index_rows( int $row_id, int $field_id, array $rows, bool $delete_existing, bool $can_have_multiple_values ): int {
		global $wpdb;

		if ( $delete_existing && ! $can_have_multiple_values ) {
			if ( count( $rows ) === 0 ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Updates the derived index for one row field.
				$wpdb->delete(
					$this->table_name(),
					array(
						'row_id'   => $row_id,
						'field_id' => $field_id,
					),
					array( '%d', '%d' )
				);
				return 0;
			}

			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Updates the derived index for one single-value row field.
			$result = $wpdb->replace(
				$this->table_name(),
				$rows[0],
				array( '%d', '%d', '%d', '%d', '%s', '%d', '%f', '%s', '%s' )
			);
			if ( false === $result ) {
				$this->mark_stale( __( 'Cortext could not write to the field-value index.', 'cortext' ) );
				return 0;
			}
			return 1;
		}

		if ( $delete_existing ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Updates the derived index for one row field.
			$wpdb->delete(
				$this->table_name(),
				array(
					'row_id'   => $row_id,
					'field_id' => $field_id,
				),
				array( '%d', '%d' )
			);
		}

		$inserted = 0;
		foreach ( $rows as $row ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery -- Updates the derived index for one row field.
			$result = $wpdb->insert(
				$this->table_name(),
				$row,
				array( '%d', '%d', '%d', '%d', '%s', '%d', '%f', '%s', '%s' )
			);
			if ( false === $result ) {
				$this->mark_stale( __( 'Cortext could not write to the field-value index.', 'cortext' ) );
				return $inserted;
			}
			++$inserted;
		}

		return $inserted;
	}

	public function sync_meta_change( mixed $meta_id, int $object_id, string $meta_key, mixed $meta_value = null ): void {
		unset( $meta_id, $meta_value );

		if ( self::sync_is_suspended() || ! $this->is_field_meta_key( $meta_key ) || ! $this->can_write() ) {
			return;
		}

		$field_id = $this->field_id_from_meta_key( $meta_key );
		if ( $field_id < 1 ) {
			return;
		}

		$this->queue_row_field( $object_id, $field_id );
	}

	public function flush_pending_sync(): int {
		if ( self::sync_is_suspended() || count( self::$pending_row_fields ) === 0 || ! $this->can_write() ) {
			return 0;
		}

		$pending                  = self::$pending_row_fields;
		self::$pending_row_fields = array();

		$indexed = 0;
		foreach ( $pending as $entry ) {
			$indexed += $this->index_row_field(
				(int) $entry['row_id'],
				(int) $entry['field_id'],
				isset( $entry['collection_id'] ) ? (int) $entry['collection_id'] : null
			);
		}

		return $indexed;
	}

	private function queue_row_field( int $row_id, int $field_id, ?int $collection_id = null ): void {
		self::$pending_row_fields[ "{$row_id}:{$field_id}" ] = array_filter(
			array(
				'row_id'        => $row_id,
				'field_id'      => $field_id,
				'collection_id' => $collection_id,
			),
			static fn( mixed $value ): bool => null !== $value
		);
	}

	public function sync_row_status( int $post_id ): void {
		if ( ! $this->can_write() || $this->collection_id_for_row( $post_id ) < 1 ) {
			return;
		}

		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Keeps row status in the derived index current.
		$result = $wpdb->update(
			$this->table_name(),
			array( 'post_status' => (string) get_post_status( $post_id ) ),
			array( 'row_id' => $post_id ),
			array( '%s' ),
			array( '%d' )
		);
		if ( false === $result ) {
			$this->mark_stale( __( 'Cortext could not update field-value index status.', 'cortext' ) );
		}
	}

	public function cleanup_deleted_post( int $post_id, ?WP_Post $post = null ): void {
		if ( ! $this->is_enabled() || ! $this->table_exists() ) {
			return;
		}

		$post_type = $post instanceof WP_Post ? $post->post_type : get_post_type( $post_id );
		if ( Field::POST_TYPE === $post_type ) {
			$this->delete_field( $post_id );
			return;
		}

		if ( Document::POST_TYPE === $post_type && Document::is_collection( (int) $post_id ) ) {
			$this->delete_collection( $post_id );
			return;
		}

		if ( Document::POST_TYPE === $post_type && $this->is_indexed_document( $post_id ) ) {
			$this->delete_row( $post_id );
		}
	}

	/**
	 * Whether a `crtxt_document` post has trait membership and therefore is
	 * indexed in the field-value table. Pages do not.
	 *
	 * @param int $document_id Document post id.
	 */
	private function is_indexed_document( int $document_id ): bool {
		$terms = wp_get_object_terms(
			$document_id,
			TraitTaxonomy::TAXONOMY,
			array( 'fields' => 'ids' )
		);
		return is_array( $terms ) && count( $terms ) > 0;
	}

	public function query_two_field_filter_ids(
		int $collection_id,
		int $number_field_id,
		float $minimum,
		int $select_field_id,
		string $select_value,
		int $limit
	): array {
		$this->flush_pending_sync();

		global $wpdb;

		$table = $this->table_name();
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT n.row_id
				FROM {$table} AS n
				INNER JOIN {$table} AS s ON s.row_id = n.row_id
				WHERE n.collection_id = %d
				AND n.field_id = %d
				AND n.value_number > %f
				AND n.post_status IN ('draft', 'private', 'publish')
				AND s.collection_id = %d
				AND s.field_id = %d
				AND s.value_text = %s
				AND s.post_status IN ('draft', 'private', 'publish')
				ORDER BY n.row_id ASC
				LIMIT %d",
				$collection_id,
				$number_field_id,
				$minimum,
				$collection_id,
				$select_field_id,
				$select_value,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array_map( 'intval', $ids );
	}

	public function query_date_sort_ids( int $collection_id, int $date_field_id, int $limit ): array {
		$this->flush_pending_sync();

		global $wpdb;

		$table = $this->table_name();
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT row_id
				FROM {$table}
				WHERE collection_id = %d
				AND field_id = %d
				AND value_date IS NOT NULL
				AND post_status IN ('draft', 'private', 'publish')
				ORDER BY value_date ASC, row_id ASC
				LIMIT %d",
				$collection_id,
				$date_field_id,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array_map( 'intval', $ids );
	}

	public function query_relation_contains_ids( int $collection_id, int $relation_field_id, int $target_row_id, int $limit ): array {
		$this->flush_pending_sync();

		global $wpdb;

		$table = $this->table_name();
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT row_id
				FROM {$table}
				WHERE collection_id = %d
				AND field_id = %d
				AND value_text = %s
				AND post_status IN ('draft', 'private', 'publish')
				ORDER BY row_id ASC
				LIMIT %d",
				$collection_id,
				$relation_field_id,
				(string) $target_row_id,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map( 'intval', $ids );
	}

	public function query_date_sort_filtered_ids(
		int $collection_id,
		int $date_field_id,
		int $number_field_id,
		float $minimum,
		int $select_field_id,
		string $select_value,
		int $limit
	): array {
		$this->flush_pending_sync();

		global $wpdb;

		$table = $this->table_name();
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT d.row_id
				FROM {$table} AS d
				INNER JOIN {$table} AS n ON n.collection_id = d.collection_id AND n.row_id = d.row_id
				INNER JOIN {$table} AS s ON s.collection_id = d.collection_id AND s.row_id = d.row_id
				WHERE d.collection_id = %d
				AND d.field_id = %d
				AND d.value_date IS NOT NULL
				AND d.post_status IN ('draft', 'private', 'publish')
				AND n.field_id = %d
				AND n.value_number > %f
				AND n.post_status IN ('draft', 'private', 'publish')
				AND s.field_id = %d
				AND s.value_text = %s
				AND s.post_status IN ('draft', 'private', 'publish')
				ORDER BY d.value_date ASC, d.row_id ASC
				LIMIT %d",
				$collection_id,
				$date_field_id,
				$number_field_id,
				$minimum,
				$select_field_id,
				$select_value,
				$limit
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return array_map( 'intval', $ids );
	}

	public function query_text_search_ids( int $collection_id, array $field_ids, string $term, int $limit ): array {
		$this->flush_pending_sync();

		$field_ids = array_values( array_filter( array_map( 'intval', $field_ids ) ) );
		if ( count( $field_ids ) === 0 ) {
			return array();
		}

		global $wpdb;

		$table        = $this->table_name();
		$placeholders = implode( ', ', array_fill( 0, count( $field_ids ), '%d' ) );
		$like         = '%' . $wpdb->esc_like( $term ) . '%';
		$args         = array_merge( array( $collection_id ), $field_ids, array( $like, $limit ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT row_id
				FROM {$table}
				WHERE collection_id = %d
				AND field_id IN ({$placeholders})
				AND value_text LIKE %s
				AND post_status IN ('draft', 'private', 'publish')
				ORDER BY row_id ASC
				LIMIT %d",
				...$args
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array_map( 'intval', $ids );
	}

	public function query_text_search_filtered_ids(
		int $collection_id,
		array $field_ids,
		string $term,
		int $number_field_id,
		float $minimum,
		int $select_field_id,
		string $select_value,
		int $limit
	): array {
		$this->flush_pending_sync();

		$field_ids = array_values( array_filter( array_map( 'intval', $field_ids ) ) );
		if ( count( $field_ids ) === 0 ) {
			return array();
		}

		global $wpdb;

		$table        = $this->table_name();
		$placeholders = implode( ', ', array_fill( 0, count( $field_ids ), '%d' ) );
		$like         = '%' . $wpdb->esc_like( $term ) . '%';
		$args         = array_merge( array( $collection_id ), $field_ids, array( $like, $number_field_id, $minimum, $select_field_id, $select_value, $limit ) );

		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		$ids = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT DISTINCT t.row_id
				FROM {$table} AS t
				INNER JOIN {$table} AS n ON n.collection_id = t.collection_id AND n.row_id = t.row_id
				INNER JOIN {$table} AS s ON s.collection_id = t.collection_id AND s.row_id = t.row_id
				WHERE t.collection_id = %d
				AND t.field_id IN ({$placeholders})
				AND t.value_text LIKE %s
				AND t.post_status IN ('draft', 'private', 'publish')
				AND n.field_id = %d
				AND n.value_number > %f
				AND n.post_status IN ('draft', 'private', 'publish')
				AND s.field_id = %d
				AND s.value_text = %s
				AND s.post_status IN ('draft', 'private', 'publish')
				ORDER BY t.row_id ASC
				LIMIT %d",
				...$args
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.ReplacementsWrongNumber

		return array_map( 'intval', $ids );
	}

	public function aggregate_number( int $collection_id, int $field_id, string $operation ): float|int {
		$this->flush_pending_sync();

		global $wpdb;

		$function = 'count' === $operation ? 'COUNT(value_number)' : 'COALESCE(SUM(value_number), 0)';
		$table    = $this->table_name();
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		$value = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT {$function}
				FROM {$table}
				WHERE collection_id = %d
				AND field_id = %d
				AND value_number IS NOT NULL
				AND post_status IN ('draft', 'private', 'publish')",
				$collection_id,
				$field_id
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared

		return 'count' === $operation ? (int) $value : (float) $value;
	}

	public function count_text_value( int $collection_id, int $field_id, string $value ): int {
		$this->flush_pending_sync();

		global $wpdb;

		$table = $this->table_name();
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Benchmark reads directly from the derived index.
		return (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT COUNT(*)
				FROM {$table}
				WHERE collection_id = %d
				AND field_id = %d
				AND value_text = %s
				AND post_status IN ('draft', 'private', 'publish')",
				$collection_id,
				$field_id,
				$value
			)
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	public function normalized_value_rows( int $field_id, string $field_type, mixed $stored, string $post_status = 'private' ): array {
		$values = is_array( $stored ) ? array_values( $stored ) : array( $stored );
		$rows   = array();
		$seq    = 0;

		foreach ( $values as $value ) {
			if ( null === $value || '' === $value ) {
				continue;
			}

			$text   = is_scalar( $value ) ? (string) $value : wp_json_encode( $value );
			$text   = is_string( $text ) ? $text : '';
			$number = is_numeric( $value ) ? (float) $value : null;
			$date   = null;

			if ( 'checkbox' === $field_type ) {
				$number = Relations::is_truthy( $value ) ? 1.0 : 0.0;
				$text   = Relations::is_truthy( $value ) ? '1' : '0';
			} elseif ( in_array( $field_type, array( 'date', 'datetime' ), true ) ) {
				$date = $this->normalized_date_for_index( $value, $field_type );
			}

			if ( 'number' !== $field_type ) {
				$number = 'checkbox' === $field_type ? $number : null;
			}

			$rows[] = array(
				'field_id'          => $field_id,
				'value_seq'         => $seq,
				'value_text'        => substr( $text, 0, self::TEXT_INDEX_LENGTH ),
				'value_text_length' => strlen( $text ),
				'value_number'      => $number,
				'value_date'        => $date,
				'post_status'       => $post_status,
			);
			++$seq;
		}

		return $rows;
	}

	private function create_table(): bool {
		global $wpdb;

		$table           = $this->table_name();
		$charset_collate = $wpdb->get_charset_collate();

		require_once ABSPATH . 'wp-admin/includes/upgrade.php';

		$sql = "CREATE TABLE {$table} (
			row_id bigint(20) unsigned NOT NULL,
			collection_id bigint(20) unsigned NOT NULL,
			field_id bigint(20) unsigned NOT NULL,
			value_seq smallint(5) unsigned NOT NULL DEFAULT 0,
			value_text varchar(191) DEFAULT NULL,
			value_text_length int(10) unsigned DEFAULT NULL,
			value_number decimal(20,6) DEFAULT NULL,
			value_date datetime DEFAULT NULL,
			post_status varchar(20) NOT NULL DEFAULT 'publish',
			PRIMARY KEY  (row_id, field_id, value_seq),
			KEY collection_field_text_len (collection_id, field_id, value_text, value_text_length, row_id),
			KEY collection_field_number (collection_id, field_id, value_number, row_id),
			KEY collection_field_date (collection_id, field_id, value_date, row_id),
			KEY collection_row (collection_id, row_id)
		) {$charset_collate};";

		dbDelta( $sql );
		return $this->table_exists( true );
	}

	private function table_exists( bool $refresh = false ): bool {
		global $wpdb;

		$table = $this->table_name();
		if ( ! $refresh && array_key_exists( $table, self::$table_exists_cache ) ) {
			return self::$table_exists_cache[ $table ];
		}

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Schema health check.
		self::$table_exists_cache[ $table ] = $table === (string) $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $table ) );
		return self::$table_exists_cache[ $table ];
	}

	private function schema_is_current(): bool {
		return (int) get_option( self::SCHEMA_VERSION_OPTION, 0 ) === self::SCHEMA_VERSION;
	}

	private function set_status( string $status, string $error = '' ): void {
		update_option( self::STATUS_OPTION, $status, false );
		update_option( self::STATUS_ERROR_OPTION, $error, false );
	}

	private function record_disabled_state(): void {
		if ( (int) get_option( self::DISABLED_SINCE_OPTION, 0 ) > 0 ) {
			return;
		}

		update_option( self::DISABLED_SINCE_OPTION, time(), false );
	}

	private function schedule_auto_rebuild( int $delay = 10 ): void {
		if ( false !== wp_next_scheduled( self::AUTO_REBUILD_HOOK ) ) {
			return;
		}

		wp_schedule_single_event( time() + $delay, self::AUTO_REBUILD_HOOK );
	}

	private function claim_auto_rebuild_lock(): bool {
		$locked_at = (int) get_option( self::AUTO_REBUILD_LOCK, 0 );
		if ( $locked_at > time() - ( 15 * MINUTE_IN_SECONDS ) ) {
			return false;
		}

		update_option( self::AUTO_REBUILD_LOCK, time(), false );
		return true;
	}

	private function collection_ids(): array {
		return array_map(
			'intval',
			get_posts(
				array(
					'post_type'      => Document::POST_TYPE,
					'post_status'    => array( 'draft', 'private', 'publish' ),
					'fields'         => 'ids',
					'posts_per_page' => -1,
					'meta_query'     => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
						array(
							'key'     => 'cortext_fields',
							'compare' => 'EXISTS',
						),
					),
				)
			)
		);
	}

	private function delete_collection( int $collection_id ): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Rebuild clears the derived index for one collection.
		$wpdb->delete(
			$this->table_name(),
			array( 'collection_id' => $collection_id ),
			array( '%d' )
		);
	}

	private function delete_row( int $row_id ): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Deletes derived index rows for a deleted row.
		$wpdb->delete(
			$this->table_name(),
			array( 'row_id' => $row_id ),
			array( '%d' )
		);
	}

	private function delete_field( int $field_id ): void {
		global $wpdb;

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Deletes derived index rows for a deleted field.
		$wpdb->delete(
			$this->table_name(),
			array( 'field_id' => $field_id ),
			array( '%d' )
		);
	}

	private function index_rows_for_row_field( int $row_id, int $field_id, int $collection_id ): array {
		$raw_field_type = (string) get_post_meta( $field_id, 'type', true );
		if ( '' === $raw_field_type || 'rollup' === $raw_field_type ) {
			return array();
		}

		$key         = Relations::meta_key( $field_id );
		$field_type  = FieldTypeRegistry::effective_type_for_field( $field_id, $raw_field_type );
		$is_multiple = 'multiselect' === $raw_field_type || ( 'relation' === $raw_field_type && Relations::relation_is_multiple( $field_id ) );
		$stored      = get_post_meta( $row_id, $key, ! $is_multiple );
		$post_status = (string) get_post_status( $row_id );
		$rows        = array();

		foreach ( $this->normalized_value_rows( $field_id, $field_type, $stored, $post_status ) as $row ) {
			$rows[] = array(
				'row_id'            => $row_id,
				'collection_id'     => $collection_id,
				'field_id'          => $row['field_id'],
				'value_seq'         => $row['value_seq'],
				'value_text'        => $row['value_text'],
				'value_text_length' => $row['value_text_length'],
				'value_number'      => $row['value_number'],
				'value_date'        => $row['value_date'],
				'post_status'       => $row['post_status'],
			);
		}

		return $rows;
	}

	private function field_can_have_multiple_values( int $field_id ): bool {
		$field_type = (string) get_post_meta( $field_id, 'type', true );
		return $this->known_type_can_have_multiple_values( $field_id, $field_type );
	}

	private function known_type_can_have_multiple_values( int $field_id, string $field_type ): bool {
		return 'multiselect' === $field_type || ( 'relation' === $field_type && Relations::relation_is_multiple( $field_id ) );
	}

	private function indexed_rows_for_collection( int $collection_id ): array {
		global $wpdb;

		$table = $this->table_name();
		// phpcs:disable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching -- Verification compares the derived index to the postmeta source of truth.
		return $wpdb->get_results(
			$wpdb->prepare(
				"SELECT row_id, collection_id, field_id, value_seq, value_text, value_number, value_date, post_status
				FROM {$table}
				WHERE collection_id = %d",
				$collection_id
			),
			ARRAY_A
		);
		// phpcs:enable WordPress.DB.PreparedSQL.InterpolatedNotPrepared
	}

	private function signature( array $row ): string {
		return implode(
			'|',
			array(
				(int) $row['row_id'],
				(int) $row['collection_id'],
				(int) $row['field_id'],
				(int) $row['value_seq'],
				(string) ( $row['value_text'] ?? '' ),
				null === ( $row['value_number'] ?? null ) ? '' : (string) (float) $row['value_number'],
				(string) ( $row['value_date'] ?? '' ),
				(string) ( $row['post_status'] ?? '' ),
			)
		);
	}

	private function collection_id_for_row( int $row_id ): int {
		if ( array_key_exists( $row_id, self::$collection_id_by_row_cache ) ) {
			return self::$collection_id_by_row_cache[ $row_id ];
		}

		$collection_id = $this->resolve_collection_id_for_row( $row_id );

		self::$collection_id_by_row_cache[ $row_id ] = $collection_id;
		return $collection_id;
	}

	private function resolve_collection_id_for_row( int $row_id ): int {
		$post = get_post( $row_id );
		if ( ! $post instanceof WP_Post || Document::POST_TYPE !== $post->post_type ) {
			return 0;
		}

		$terms = wp_get_object_terms(
			$row_id,
			TraitTaxonomy::TAXONOMY,
			array( 'fields' => 'all' )
		);
		if ( ! is_array( $terms ) || count( $terms ) === 0 ) {
			return 0;
		}

		return TraitTaxonomy::trait_id_from_slug( (string) $terms[0]->slug );
	}

	private function is_field_meta_key( string $meta_key ): bool {
		return 1 === preg_match( '/^field-\d+$/', $meta_key );
	}

	private function field_id_from_meta_key( string $meta_key ): int {
		return $this->is_field_meta_key( $meta_key ) ? (int) substr( $meta_key, 6 ) : 0;
	}

	private function normalized_date_for_index( mixed $value, string $field_type ): ?string {
		$text = trim( (string) $value );
		if ( '' === $text ) {
			return null;
		}

		$timestamp = strtotime( $text );
		if ( false === $timestamp ) {
			return null;
		}

		return 'date' === $field_type
			? gmdate( 'Y-m-d 00:00:00', $timestamp )
			: gmdate( 'Y-m-d H:i:s', $timestamp );
	}
}
