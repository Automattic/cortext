<?php
/**
 * WP-CLI helper for rebuilding the Cortext mention index.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\CLI;

defined( 'ABSPATH' ) || exit;

use Cortext\Taxonomy\MentionTaxonomy;
use WP_CLI;
use WP_CLI_Command;

final class BackfillMentions extends WP_CLI_Command {

	/**
	 * Rebuilds inline document mentions for existing Cortext documents.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext backfill-mentions
	 *
	 * @when after_wp_load
	 */
	public function __invoke(): void {
		$result = ( new MentionTaxonomy() )->backfill();

		WP_CLI::success(
			sprintf(
				'Indexed %d mention(s) in %d document(s).',
				$result['mentions'],
				$result['documents']
			)
		);
	}
}
