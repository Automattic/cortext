<?php
/**
 * WP-CLI commands for Cortext's field-value index.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\CLI;

use Cortext\FieldValues\FieldValueIndex;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;

final class FieldValues {

	/**
	 * Installs or updates the field-value index table.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext field-values install
	 *
	 * @when after_wp_load
	 */
	public function install(): void {
		$this->ensure_post_types();
		$index = new FieldValueIndex();
		if ( $index->install() ) {
			\WP_CLI::success( 'Field-value index table installed.' );
			return;
		}

		\WP_CLI::warning( 'Field-value index table is unavailable; Cortext will keep using postmeta.' );
		$this->print_status( $index->status() );
	}

	/**
	 * Prints the field-value index status.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext field-values status
	 *
	 * @when after_wp_load
	 */
	public function status(): void {
		$this->print_status( ( new FieldValueIndex() )->status() );
	}

	/**
	 * Rebuilds the field-value index from postmeta.
	 *
	 * ## OPTIONS
	 *
	 * [--collection=<id>]
	 * : Rebuild only one collection. Defaults to every collection.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext field-values rebuild
	 *     wp cortext field-values rebuild --collection=123
	 *
	 * @when after_wp_load
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function rebuild( array $args, array $assoc_args ): void {
		unset( $args );

		$this->ensure_post_types();
		( new CollectionEntries() )->register_all();

		$index          = new FieldValueIndex();
		$collection_ids = $this->collection_ids_from_args( $assoc_args );
		$total_rows     = 0;
		$total_values   = 0;

		foreach ( $collection_ids as $collection_id ) {
			$result        = $index->rebuild_collection( $collection_id );
			$total_rows   += (int) $result['indexedRows'];
			$total_values += (int) $result['valueRows'];
			\WP_CLI::line(
				sprintf(
					'Collection %d rebuilt: %d rows, %d indexed values.',
					$collection_id,
					(int) $result['indexedRows'],
					(int) $result['valueRows']
				)
			);
		}

		\WP_CLI::success(
			sprintf(
				'Field-value index rebuilt: %d rows, %d indexed values.',
				$total_rows,
				$total_values
			)
		);
	}

	/**
	 * Checks the field-value index against postmeta.
	 *
	 * ## OPTIONS
	 *
	 * [--collection=<id>]
	 * : Verify only one collection. Defaults to every collection.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext field-values verify
	 *
	 * @when after_wp_load
	 *
	 * @param array $args       Positional arguments.
	 * @param array $assoc_args Associative arguments.
	 */
	public function verify( array $args, array $assoc_args ): void {
		unset( $args );

		$this->ensure_post_types();
		( new CollectionEntries() )->register_all();

		$index   = new FieldValueIndex();
		$passed  = true;
		$results = array();

		foreach ( $this->collection_ids_from_args( $assoc_args ) as $collection_id ) {
			$result    = $index->verify_collection( $collection_id );
			$results[] = $result;
			$passed    = $passed && ! empty( $result['passed'] );
		}

		\WP_CLI\Utils\format_items( 'table', $results, array( 'collectionId', 'expectedRows', 'actualRows', 'missing', 'extra', 'passed' ) );

		if ( ! $passed ) {
			\WP_CLI::error( 'Field-value index does not match postmeta.' );
			return;
		}

		\WP_CLI::success( 'Field-value index matches postmeta.' );
	}

	private function ensure_post_types(): void {
		if ( ! post_type_exists( Collection::POST_TYPE ) ) {
			( new Collection() )->register_post_type();
		}
		if ( ! post_type_exists( Field::POST_TYPE ) ) {
			( new Field() )->register_post_type();
		}
	}

	private function collection_ids_from_args( array $assoc_args ): array {
		$collection_id = isset( $assoc_args['collection'] ) ? (int) $assoc_args['collection'] : 0;
		if ( $collection_id > 0 ) {
			return array( $collection_id );
		}

		return array_map(
			'intval',
			get_posts(
				array(
					'post_type'      => Collection::POST_TYPE,
					'post_status'    => array( 'draft', 'private', 'publish' ),
					'fields'         => 'ids',
					'posts_per_page' => -1,
				)
			)
		);
	}

	private function print_status( array $status ): void {
		\WP_CLI::line(
			wp_json_encode(
				$status,
				JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES
			)
		);
	}
}
