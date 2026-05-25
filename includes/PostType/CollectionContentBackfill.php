<?php
/**
 * One-shot migration for full-page collections created before the locked
 * data-view body existed.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\PostType;

final class CollectionContentBackfill {

	private const OPTION_KEY               = 'cortext_collection_data_view_backfill_v1';
	private const REWRITE_FLUSH_OPTION_KEY = 'cortext_collection_rewrite_flush_v1';

	public function register(): void {
		add_action( 'init', array( $this, 'maybe_run' ), 20 );
	}

	/**
	 * Two one-shot tasks gated by their own options:
	 *
	 * - The data-view backfill loop. Marks complete only when every collection
	 *   that needed updating was updated successfully. A failure leaves the
	 *   option unset so the next request retries the stragglers. Already seeded
	 *   collections short-circuit via has_owner_data_view_block, so the retry
	 *   only repeats what failed.
	 * - The rewrite-rules flush. Marks complete after the first run regardless
	 *   of backfill success; rewrites need refreshing because this release
	 *   gives collections public permalinks and plugin upgrades do not run the
	 *   activation hook. Sharing an option with the backfill would re-run a
	 *   slow .htaccess rewrite on every request as long as one collection's
	 *   wp_update_post kept failing.
	 */
	public function maybe_run(): void {
		if ( ! get_option( self::OPTION_KEY ) ) {
			if ( $this->backfill() ) {
				update_option( self::OPTION_KEY, time(), false );
			}
		}

		if ( ! get_option( self::REWRITE_FLUSH_OPTION_KEY ) ) {
			flush_rewrite_rules( false );
			update_option( self::REWRITE_FLUSH_OPTION_KEY, time(), false );
		}
	}

	private function backfill(): bool {
		$query = new \WP_Query(
			array(
				'post_type'              => Collection::POST_TYPE,
				'post_status'            => 'any',
				'posts_per_page'         => -1,
				'fields'                 => 'ids',
				'no_found_rows'          => true,
				'update_post_meta_cache' => false,
				'update_post_term_cache' => false,
			)
		);

		$all_succeeded = true;

		foreach ( $query->posts as $collection_id ) {
			$collection_id = (int) $collection_id;
			if ( Collection::is_inline( $collection_id ) ) {
				continue;
			}

			$post = get_post( $collection_id );
			if ( ! $post instanceof \WP_Post ) {
				continue;
			}

			if ( Collection::has_owner_data_view_block( (string) $post->post_content, $collection_id ) ) {
				continue;
			}

			// One bad post should not stop the rest of the migration, but
			// any failure means we leave the option unset so the next
			// request retries the affected collections.
			try {
				$result = wp_update_post(
					array(
						'ID'           => $collection_id,
						'post_content' => $post->post_content . Collection::build_data_view_block_markup( $collection_id ),
					),
					true
				);
				if ( is_wp_error( $result ) || 0 === $result ) {
					$all_succeeded = false;
				}
			} catch ( \Throwable $e ) {
				$all_succeeded = false;
				continue;
			}
		}

		return $all_succeeded;
	}
}
