<?php
/**
 * WP-CLI command that stamps existing Cortext media with the `cortext_media`
 * term so it surfaces in the Cortext media pickers.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\CLI;

defined( 'ABSPATH' ) || exit;

use Cortext\Media\CortextMedia;
use WP_CLI;
use WP_CLI_Command;

final class BackfillMedia extends WP_CLI_Command {

	/**
	 * Tags media uploaded from Cortext that predates upload-time tagging:
	 * attachments parented to a document, document covers, and image icons.
	 * Idempotent, so it is safe to run more than once.
	 *
	 * ## EXAMPLES
	 *
	 *     wp cortext backfill-media
	 *
	 * @when after_wp_load
	 */
	public function __invoke(): void {
		$result = ( new CortextMedia() )->backfill();

		WP_CLI::success(
			sprintf(
				'Tagged %d attachment(s) across %d document(s).',
				$result['tagged'],
				$result['documents']
			)
		);
	}
}
