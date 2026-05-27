<?php
/**
 * Notion import jobs: client-orchestrated, batch-by-batch.
 *
 * Two routes:
 *   - POST /cortext/v1/notion/import/start
 *       Body:   { data_source_id }
 *       Header: X-Notion-Key
 *       Side-effect: Cortext collection + per-property fields are
 *                    created. Job state is persisted under a new
 *                    option so subsequent ticks can resume cursor +
 *                    progress.
 *       Returns: { job_id, collection_id, status }
 *
 *   - POST /cortext/v1/notion/import/{job_id}/tick
 *       Header: X-Notion-Key
 *       Side-effect: One page of `/data_sources/{id}/query` results
 *                    is fetched from Notion and inserted as rows.
 *       Returns: { job_id, processed, has_more, status, message? }
 *
 * No background queue. The client loops `tick` until `has_more: false`,
 * showing progress to the user. If the tab closes mid-import, the
 * partial collection stays. Re-running Import always makes a new copy
 * (per v1 product decision).
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Notion\Importer;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class NotionImportJobsController {

	private const NAMESPACE         = 'cortext/v1';
	private const NOTION_BASE       = 'https://api.notion.com/v1';
	private const NOTION_VER        = '2026-03-11';
	private const TIMEOUT_SECS      = 15;
	private const TICK_PAGE_SIZE    = 3; // FIXME: Low value during testing
	private const JOB_OPTION_PREFIX = 'cortext_notion_import_';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/notion/import/start',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'start' ),
				'permission_callback' => array( $this, 'can_import' ),
				'args'                => array(
					'data_source_id' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);

		register_rest_route(
			self::NAMESPACE,
			'/notion/import/(?P<job_id>[a-zA-Z0-9_-]+)/tick',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'tick' ),
				'permission_callback' => array( $this, 'can_import' ),
				'args'                => array(
					'job_id' => array(
						'type'     => 'string',
						'required' => true,
					),
				),
			)
		);
	}

	public function can_import(): bool {
		return current_user_can( 'edit_posts' );
	}

	// -----------------------------------------------------------------
	// /import/start
	// -----------------------------------------------------------------

	/**
	 * POST /cortext/v1/notion/import/start
	 *
	 * Creates the Cortext collection + fields up-front so subsequent
	 * tick calls only need to write rows. Returns the job id the client
	 * loops with.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public function start( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$key = $this->require_key( $request );
		if ( is_wp_error( $key ) ) {
			return $key;
		}

		$data_source_id = trim( (string) $request->get_param( 'data_source_id' ) );
		if ( '' === $data_source_id ) {
			return new WP_Error(
				'cortext_notion_missing_data_source',
				__( 'Missing data_source_id.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		// 1) Fetch the data source schema from Notion.
		$schema = $this->notion_get( $key, '/data_sources/' . rawurlencode( $data_source_id ) );
		if ( is_wp_error( $schema ) ) {
			return $schema;
		}

		// 2) Hand off to the Importer service to create the collection
		// and its fields. The service also registers the row CPT and
		// per-field meta so the tick route can insert rows straight
		// away.
		$importer      = new Importer();
		$collection_id = $importer->create_collection( $schema );
		if ( is_wp_error( $collection_id ) ) {
			return new WP_Error(
				'cortext_notion_import_collection_failed',
				$collection_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

		// 3) Stamp a job record so ticks can resume the cursor.
		$job_id = wp_generate_uuid4();
		$this->save_job(
			$job_id,
			array(
				'collection_id'   => (int) $collection_id,
				'collection_slug' => (string) get_post_meta( (int) $collection_id, 'slug', true ),
				'data_source_id'  => $data_source_id,
				'cursor'          => null,
				'processed'       => 0,
				'status'          => 'running',
				'message'         => null,
				'started_at'      => time(),
			)
		);

		return $this->job_response( $job_id, $this->load_job( $job_id ) );
	}

	// -----------------------------------------------------------------
	// /import/{job_id}/tick
	// -----------------------------------------------------------------

	/**
	 * POST /cortext/v1/notion/import/{job_id}/tick
	 *
	 * Pulls one page of rows from Notion and writes them. Returns the
	 * updated job state so the client knows whether to call again.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public function tick( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$key = $this->require_key( $request );
		if ( is_wp_error( $key ) ) {
			return $key;
		}

		$job_id = (string) $request->get_param( 'job_id' );
		$job    = $this->load_job( $job_id );
		if ( null === $job ) {
			return new WP_Error(
				'cortext_notion_import_job_not_found',
				__( 'Import job not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		// Idempotency: ticking a finished job returns its terminal state.
		if ( 'running' !== $job['status'] ) {
			return $this->job_response( $job_id, $job );
		}

		$body = array( 'page_size' => self::TICK_PAGE_SIZE );
		if ( ! empty( $job['cursor'] ) ) {
			$body['start_cursor'] = (string) $job['cursor'];
		}

		$response = $this->notion_post(
			$key,
			'/data_sources/' . rawurlencode( (string) $job['data_source_id'] ) . '/query',
			$body
		);
		if ( is_wp_error( $response ) ) {
			// Leave the job at status=running so the client can retry
			// the same tick after backing off.
			return $response;
		}

		$results  = is_array( $response['results'] ?? null ) ? $response['results'] : array();
		$has_more = ! empty( $response['has_more'] );
		$cursor   = $has_more ? ( $response['next_cursor'] ?? null ) : null;

		$importer = new Importer();
		$inserted = $importer->import_rows( (int) $job['collection_id'], $results );

		$job['processed'] += $inserted;
		$job['cursor']     = $cursor;
		$job['status']     = $has_more ? 'running' : 'done';
		$this->save_job( $job_id, $job );

		return $this->job_response( $job_id, $job );
	}

	// -----------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------

	/**
	 * Serialise a job record into the wire shape the client renders.
	 *
	 * @param string $job_id Job identifier.
	 * @param array  $job    Job state from the option store.
	 */
	private function job_response( string $job_id, array $job ): WP_REST_Response {
		return new WP_REST_Response(
			array(
				'job_id'          => $job_id,
				'collection_id'   => (int) $job['collection_id'],
				'collection_slug' => (string) ( $job['collection_slug'] ?? '' ),
				'processed'       => (int) $job['processed'],
				'status'          => (string) $job['status'],
				'has_more'        => 'running' === $job['status'],
				'message'         => $job['message'] ?? null,
			),
			200
		);
	}

	private function require_key( WP_REST_Request $request ) {
		$key = trim( (string) $request->get_header( 'x_notion_key' ) );
		if ( '' === $key ) {
			return new WP_Error(
				'cortext_notion_missing_key',
				__( 'Missing Notion API key.', 'cortext' ),
				array( 'status' => 400 )
			);
		}
		return $key;
	}

	private function load_job( string $job_id ): ?array {
		$value = get_option( self::JOB_OPTION_PREFIX . $job_id, null );
		if ( ! is_array( $value ) ) {
			return null;
		}
		return $value;
	}

	private function save_job( string $job_id, array $job ): void {
		update_option( self::JOB_OPTION_PREFIX . $job_id, $job, false );
	}

	private function notion_get( string $key, string $path ) {
		return $this->notion_request( $key, 'GET', $path, null );
	}

	private function notion_post( string $key, string $path, array $body ) {
		return $this->notion_request( $key, 'POST', $path, $body );
	}

	/**
	 * Thin wrapper over `wp_remote_request` that mirrors Notion's status
	 * and surfaces upstream JSON errors back to the client as WP_Errors
	 * with matching status — same pattern as the proxy controller.
	 *
	 * @param string     $key  Notion integration token.
	 * @param string     $method HTTP verb.
	 * @param string     $path   Path under `/v1`.
	 * @param array|null $body   Optional JSON body.
	 * @return array|WP_Error    Decoded response array on success.
	 */
	private function notion_request( string $key, string $method, string $path, ?array $body ) {
		$args = array(
			'method'  => $method,
			'headers' => array(
				'Authorization'  => 'Bearer ' . $key,
				'Notion-Version' => self::NOTION_VER,
				'Content-Type'   => 'application/json',
			),
			'timeout' => self::TIMEOUT_SECS,
		);

		// `(object)` cast keeps empty POST bodies as `{}` rather than
		// `[]`. Notion rejects `[]` with a validation error.
		if ( null !== $body && 'POST' === $method ) {
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

		if ( $status < 200 || $status >= 300 ) {
			$message = is_array( $json ) && isset( $json['message'] )
				? (string) $json['message']
				: __( 'Notion API request failed.', 'cortext' );
			return new WP_Error(
				is_array( $json ) && isset( $json['code'] ) ? (string) $json['code'] : 'cortext_notion_api_error',
				$message,
				array( 'status' => $status > 0 ? $status : 502 )
			);
		}

		return is_array( $json ) ? $json : array();
	}
}
