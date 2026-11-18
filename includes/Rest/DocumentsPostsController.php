<?php
/**
 * Core posts controller for `crtxt_document` with per-document meta reads.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use WP_REST_Posts_Controller;

/**
 * Same routes, schema and writes as `WP_REST_Posts_Controller`. Only the meta
 * object changes, so `meta` reads cost the document's own fields.
 */
final class DocumentsPostsController extends WP_REST_Posts_Controller {

	/**
	 * Builds core's controller, then swaps in the per-document meta reads.
	 *
	 * @param string $post_type Post type.
	 */
	public function __construct( $post_type ) {
		parent::__construct( $post_type );
		$this->meta = new DocumentMetaFields( $this->post_type );
	}
}
