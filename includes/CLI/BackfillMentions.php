<?php
/**
 * WP-CLI command that backfills the Cortext mention index.
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
	 * Re-indexes inline document mentions in existing Cortext documents.
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
				'Indexed %d mention(s) across %d document(s).',
				$result['mentions'],
				$result['documents']
			)
		);
	}
}
