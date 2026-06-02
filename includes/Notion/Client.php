<?php
/**
 * Thin Notion API client used by Cortext's import controller.
 *
 * Stateless aside from the integration token. Mirrors Notion's status
 * codes back to WP_Error so REST callers see the upstream failure
 * shape (`code`, `message`) and can react to e.g. `rate_limited`.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Notion;

defined( 'ABSPATH' ) || exit;

use WP_Error;

final class Client {

	private const BASE_URL     = 'https://api.notion.com/v1';
	private const API_VERSION  = '2026-03-11';
	private const TIMEOUT_SECS = 15;

	private string $key;

	public function __construct( string $key ) {
		$this->key = $key;
	}

	/**
	 * GET `$path` on the Notion API.
	 *
	 * @param string $path Path under `/v1` (must start with `/`).
	 * @return array|WP_Error Decoded response array, or WP_Error on failure.
	 */
	public function get( string $path ) {
		return $this->request( 'GET', $path, null );
	}

	/**
	 * POST `$path` with the given JSON body.
	 *
	 * @param string $path Path under `/v1` (must start with `/`).
	 * @param array  $body JSON body, encoded as an object.
	 * @return array|WP_Error Decoded response array, or WP_Error on failure.
	 */
	public function post( string $path, array $body = array() ) {
		return $this->request( 'POST', $path, $body );
	}

	/**
	 * POSTs to `$path` once per page, accumulating `results` until
	 * `has_more` is false. Returns the merged result list, or the first
	 * `WP_Error` encountered. The starting body is reused for every
	 * page; `start_cursor` is appended automatically.
	 *
	 * @param string $path Path under `/v1` (must start with `/`).
	 * @param array  $body Base body merged into every page request.
	 * @return array|WP_Error Merged `results` array, or WP_Error on failure.
	 */
	public function paginate( string $path, array $body = array() ) {
		$accumulated = array();
		$cursor      = null;

		do {
			$page_body = null === $cursor
				? $body
				: array_merge( $body, array( 'start_cursor' => $cursor ) );

			$page = $this->post( $path, $page_body );
			if ( is_wp_error( $page ) ) {
				return $page;
			}

			if ( isset( $page['results'] ) && is_array( $page['results'] ) ) {
				array_push( $accumulated, ...$page['results'] );
			}

			$cursor = ! empty( $page['has_more'] )
				? ( $page['next_cursor'] ?? null )
				: null;
		} while ( null !== $cursor );

		return $accumulated;
	}

	/**
	 * Issue one request to the Notion API and decode the response.
	 *
	 * @param string     $method HTTP verb.
	 * @param string     $path   Path under `/v1` (must start with `/`).
	 * @param array|null $body   Optional JSON body for POST requests.
	 * @return array|WP_Error Decoded response array, or WP_Error on failure.
	 */
	private function request( string $method, string $path, ?array $body ) {
		$args = array(
			'method'  => $method,
			'headers' => array(
				'Authorization'  => 'Bearer ' . $this->key,
				'Notion-Version' => self::API_VERSION,
				'Content-Type'   => 'application/json',
			),
			'timeout' => self::TIMEOUT_SECS,
		);

		// Cast to object so an empty POST body encodes as `{}` rather
		// than `[]`. Notion rejects array bodies with a validation error.
		if ( 'POST' === $method && null !== $body ) {
			$args['body'] = wp_json_encode( (object) $body );
		}

		$response = wp_remote_request( self::BASE_URL . $path, $args );
		if ( is_wp_error( $response ) ) {
			return new WP_Error(
				'cortext_notion_request_failed',
				$response->get_error_message(),
				array( 'status' => 502 )
			);
		}

		$status = (int) wp_remote_retrieve_response_code( $response );
		$json   = json_decode( wp_remote_retrieve_body( $response ), true );

		if ( $status < 200 || $status >= 300 ) {
			$message = is_array( $json ) && isset( $json['message'] )
				? (string) $json['message']
				: __( 'Notion API request failed.', 'cortext' );
			$data    = array( 'status' => $status > 0 ? $status : 502 );

			if ( 429 === $status ) {
				$data['retry_after'] = max(
					1,
					(int) wp_remote_retrieve_header( $response, 'retry-after' )
				);
			}

			return new WP_Error(
				is_array( $json ) && isset( $json['code'] )
					? (string) $json['code']
					: 'cortext_notion_api_error',
				$message,
				$data
			);
		}

		return is_array( $json ) ? $json : array();
	}
}
