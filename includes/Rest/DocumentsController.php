<?php
/**
 * REST endpoint for listing and searching Cortext documents.
 *
 * Lists every post type that opts into the `cortext-document` trait (pages
 * plus collection rows) through one read surface so consumers do not have to
 * enumerate post types themselves. Single-resource reads still go through
 * `DocumentLocatorController` plus `/wp/v2/<rest_base>/<id>`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Documents;
use WP_REST_Request;
use WP_REST_Response;

final class DocumentsController {

	private const NAMESPACE = 'cortext/v1';

	private Documents $documents;

	public function __construct( ?Documents $documents = null ) {
		$this->documents = $documents ?? new Documents();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/documents',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_documents' ),
					'permission_callback' => array( $this, 'can_read' ),
					'args'                => array(
						'search'   => array(
							'type'    => 'string',
							'default' => '',
						),
						'kind'     => array(
							'type'    => 'string',
							'default' => '',
							'enum'    => array( '', Documents::KIND_PAGE, Documents::KIND_ROW ),
						),
						'page'     => array(
							'type'    => 'integer',
							'default' => 1,
							'minimum' => 1,
						),
						'per_page' => array(
							'type'              => 'integer',
							'default'           => 20,
							'validate_callback' => static fn( $value ) => (int) $value >= 1 && (int) $value <= 100,
						),
					),
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function get_documents( WP_REST_Request $request ): WP_REST_Response {
		$result = $this->documents->list(
			array(
				'search'          => (string) $request->get_param( 'search' ),
				'kind'            => (string) $request->get_param( 'kind' ),
				'page'            => (int) $request->get_param( 'page' ),
				'per_page'        => (int) $request->get_param( 'per_page' ),
				'include_excerpt' => true,
			)
		);

		return new WP_REST_Response( $result, 200 );
	}
}
