<?php
/**
 * REST endpoint for site-wide Cortext experiments.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

defined( 'ABSPATH' ) || exit;

use Cortext\Runtime\Experiments;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class ExperimentsController {

	private const NAMESPACE = 'cortext/v1';

	private Experiments $experiments;

	public function __construct( ?Experiments $experiments = null ) {
		$this->experiments = $experiments ?? new Experiments();
	}

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/experiments',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_experiments' ),
					'permission_callback' => array( $this, 'can_read' ),
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( $this, 'update_experiments' ),
					'permission_callback' => array( $this, 'can_manage' ),
					'args'                => array(
						'enabled' => array(
							'type'                 => 'object',
							'required'             => true,
							'additionalProperties' => array(
								'type' => 'boolean',
							),
						),
					),
				),
			)
		);
	}

	public function can_read(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function can_manage(): bool {
		return current_user_can( 'manage_options' );
	}

	public function get_experiments(): WP_REST_Response {
		return new WP_REST_Response( $this->response_data(), 200 );
	}

	public function update_experiments( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$enabled = $request->get_param( 'enabled' );
		if ( ! is_array( $enabled ) ) {
			return new WP_Error(
				'cortext_experiments_invalid_payload',
				__( 'Send experiment settings as an object.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$updated = $this->experiments->update( $enabled );
		if ( is_wp_error( $updated ) ) {
			return $updated;
		}

		return new WP_REST_Response( $this->response_data(), 200 );
	}

	/**
	 * Builds the REST response payload.
	 *
	 * @return array{canManage:bool,experiments:array<int,array{id:string,label:string,description:string,group:string,enabled:bool}>}
	 */
	private function response_data(): array {
		return array(
			'canManage'   => current_user_can( 'manage_options' ),
			'experiments' => $this->experiments->list(),
		);
	}
}
