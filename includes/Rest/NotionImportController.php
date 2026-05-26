<?php
/**
 * Generic REST proxy to the Notion API.
 *
 * Browser → WordPress → Notion. Notion's API does not send CORS headers, so
 * the workspace cannot call it directly. The client passes its key in
 * `X-Notion-Key` and a `{ method, path, body }` envelope; the controller
 * forwards the call server-side and mirrors Notion's status and body.
 *
 * Generic on purpose: while the importer is in iteration mode, the client
 * shape changes frequently and a typed endpoint per operation slows that
 * down. We can crystallise specific endpoints once the surface stabilises.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class NotionImportController {

	private const NAMESPACE    = 'cortext/v1';
	private const NOTION_BASE  = 'https://api.notion.com/v1';
	private const NOTION_VER   = '2026-03-11';
	private const TIMEOUT_SECS = 15;

	private const ALLOWED_METHODS = array( 'GET', 'POST' );

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/notion/proxy',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'proxy' ),
				'permission_callback' => array( $this, 'can_import' ),
				'args'                => array(
					'method' => array(
						'type'     => 'string',
						'required' => true,
						'enum'     => self::ALLOWED_METHODS,
					),
					'path'   => array(
						'type'     => 'string',
						'required' => true,
					),
					'body'   => array(
						// Untyped on purpose; Notion accepts arbitrary JSON
						// bodies and we don't want to redefine each shape.
						'required' => false,
					),
				),
			)
		);
	}

	public function can_import(): bool {
		return current_user_can( 'edit_posts' );
	}

	public function proxy( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$key = trim( (string) $request->get_header( 'x_notion_key' ) );
		if ( '' === $key ) {
			return new WP_Error(
				'cortext_notion_missing_key',
				__( 'Missing Notion API key.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$method = strtoupper( (string) $request->get_param( 'method' ) );
		$path   = (string) $request->get_param( 'path' );
		$body   = $request->get_param( 'body' );

		$path_error = $this->validate_path( $path );
		if ( null !== $path_error ) {
			return $path_error;
		}

		$args = array(
			'method'  => $method,
			'headers' => array(
				'Authorization'  => 'Bearer ' . $key,
				'Notion-Version' => self::NOTION_VER,
				'Content-Type'   => 'application/json',
			),
			'timeout' => self::TIMEOUT_SECS,
		);
		if ( 'POST' === $method && null !== $body ) {
			// Cast the top-level body to an object so an empty payload
			// encodes as `{}` rather than `[]`. WP decodes incoming JSON
			// objects into PHP associative arrays, and `wp_json_encode` on
			// an empty array would otherwise emit a JSON array, which
			// Notion rejects with `body should be an object`.
			$args['body'] = wp_json_encode( (object) $body );
		}

		$response = wp_remote_request( self::NOTION_BASE . $path, $args );

		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'cortext_notion_request_failed',
				$response->get_error_message(),
				array( 'status' => 502 )
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$json   = json_decode( wp_remote_retrieve_body( $response ), true );

		// Mirror Notion's status so apiFetch surfaces the failure to the
		// client with the upstream payload (which includes `message` and
		// `code`) preserved as the error data.
		return new WP_REST_Response( $json, $status > 0 ? $status : 502 );
	}

	/**
	 * Light path validation. The path is concatenated onto NOTION_BASE, so
	 * we just need to keep callers inside that namespace.
	 *
	 * @param string $path Path segment provided by the client.
	 */
	private function validate_path( string $path ): ?WP_Error {
		if ( '' === $path || '/' !== $path[0] ) {
			return new WP_Error(
				'cortext_notion_bad_path',
				__( 'Notion path must start with `/`.', 'cortext' ),
				array( 'status' => 400 )
			);
		}
		if ( str_contains( $path, '..' ) || str_contains( $path, '://' ) ) {
			return new WP_Error(
				'cortext_notion_bad_path',
				__( 'Notion path is not allowed.', 'cortext' ),
				array( 'status' => 400 )
			);
		}
		return null;
	}
}
