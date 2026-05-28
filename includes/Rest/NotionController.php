<?php
/**
 * Notion REST surface for the Cortext importer.
 *
 * Three routes, all gated by `X-Notion-Key`:
 *
 *   - GET  /cortext/v1/notion/collections
 *       Returns every data source the integration can reach as
 *       `{ collections: [ { id, title } ] }`. Used to populate the
 *       Import screen's list. The server owns the Notion API contract;
 *       the client never speaks Notion's protocol directly.
 *
 *   - POST /cortext/v1/notion/import/start
 *       Body:   `{ data_source_id }`. Creates the Cortext collection +
 *       fields up front and returns `{ job_id, collection_id, status }`.
 *
 *   - POST /cortext/v1/notion/import/{job_id}/tick
 *       Pulls one page of rows from Notion and writes them. Client
 *       loops until `has_more: false`.
 *
 * No background queue: the client orchestrates the tick loop and shows
 * progress. If the tab closes mid-import the partial collection stays
 * in Cortext; re-running Import always produces a new copy (per v1
 * product decision).
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\Notion\Client;
use Cortext\Notion\Importer;
use WP_Error;
use WP_REST_Request;
use WP_REST_Response;

final class NotionController {

	private const NAMESPACE         = 'cortext/v1';
	private const TICK_PAGE_SIZE    = 3; // FIXME Adjust back to a sensible size after testing.
	private const JOB_OPTION_PREFIX = 'cortext_notion_import_';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/notion/collections',
			array(
				'methods'             => 'GET',
				'callback'            => array( $this, 'list_collections' ),
				'permission_callback' => array( $this, 'can_import' ),
			)
		);

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

		register_rest_route(
			self::NAMESPACE,
			'/notion/import/(?P<job_id>[a-zA-Z0-9_-]+)/finish',
			array(
				'methods'             => 'POST',
				'callback'            => array( $this, 'finish' ),
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
	// /collections
	// -----------------------------------------------------------------

	/**
	 * GET /cortext/v1/notion/collections
	 *
	 * Paginates Notion's `/search` filtered to data sources and
	 * returns the minimal shape the Import screen needs: id + title.
	 * No schema is shipped; the create-collection step fetches schemas
	 * fresh when the user actually imports.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public function list_collections( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$client = $this->client( $request );
		if ( is_wp_error( $client ) ) {
			return $client;
		}

		$raw = $client->paginate(
			'/search',
			array(
				'filter'    => array(
					'value'    => 'data_source',
					'property' => 'object',
				),
				'page_size' => 100,
			)
		);
		if ( is_wp_error( $raw ) ) {
			return $raw;
		}

		$collections = array();
		foreach ( $raw as $data_source ) {
			$collections[] = array(
				'id'    => (string) ( $data_source['id'] ?? '' ),
				'title' => $this->data_source_title( $data_source ),
			);
		}

		return new WP_REST_Response( array( 'collections' => $collections ), 200 );
	}

	// -----------------------------------------------------------------
	// /import/start
	// -----------------------------------------------------------------

	/**
	 * POST /cortext/v1/notion/import/start
	 *
	 * Fetches the data source schema, lets `Importer` create the
	 * Cortext collection + fields, then stamps a job record so
	 * subsequent ticks can resume the cursor.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public function start( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$client = $this->client( $request );
		if ( is_wp_error( $client ) ) {
			return $client;
		}

		$data_source_id = trim( (string) $request->get_param( 'data_source_id' ) );
		if ( '' === $data_source_id ) {
			return new WP_Error(
				'cortext_notion_missing_data_source',
				__( 'Missing data_source_id.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$schema = $client->get( '/data_sources/' . rawurlencode( $data_source_id ) );
		if ( is_wp_error( $schema ) ) {
			return $schema;
		}

		$importer      = new Importer();
		$collection_id = $importer->create_collection( $schema );
		if ( is_wp_error( $collection_id ) ) {
			return new WP_Error(
				'cortext_notion_import_collection_failed',
				$collection_id->get_error_message(),
				array( 'status' => 500 )
			);
		}

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
		$client = $this->client( $request );
		if ( is_wp_error( $client ) ) {
			return $client;
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

		$response = $client->post(
			'/data_sources/' . rawurlencode( (string) $job['data_source_id'] ) . '/query',
			$body
		);
		if ( is_wp_error( $response ) ) {
			// Leave status=running so the client can retry the same
			// tick after backing off.
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
	// /import/{job_id}/finish
	// -----------------------------------------------------------------

	/**
	 * POST /cortext/v1/notion/import/{job_id}/finish
	 *
	 * Best-effort cleanup: deletes the job record once the client has
	 * observed the terminal state. Only allowed on non-running jobs to
	 * avoid discarding mid-flight cursor state. A 404 means the job is
	 * already gone, which the client should treat as success.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 */
	public function finish( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$job_id = (string) $request->get_param( 'job_id' );
		$job    = $this->load_job( $job_id );
		if ( null === $job ) {
			return new WP_Error(
				'cortext_notion_import_job_not_found',
				__( 'Import job not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		if ( 'running' === $job['status'] ) {
			return new WP_Error(
				'cortext_notion_import_job_running',
				__( 'Cannot finish a running import.', 'cortext' ),
				array( 'status' => 409 )
			);
		}

		delete_option( self::JOB_OPTION_PREFIX . $job_id );

		/**
		 * TODO: Avoid zombie jobs if something goes wrong. One simple
		 * mitigation would be to periodically find them by querying the
		 * options table and deleting those older than X.
		 *
		 * @example
		 * $wpdb->get_results("SELECT * FROM {$wpdb->options} WHERE `option_name` LIKE 'cortext_notion_import_%'")
		 */

		return new WP_REST_Response( array( 'finished' => true ), 200 );
	}

	// -----------------------------------------------------------------
	// Internals
	// -----------------------------------------------------------------

	/**
	 * Build a Notion client for this request from the `X-Notion-Key`
	 * header, or return the matching WP_Error when the header is missing.
	 *
	 * @param WP_REST_Request $request Incoming request.
	 * @return Client|WP_Error Client instance, or WP_Error when the key is missing.
	 */
	private function client( WP_REST_Request $request ) {
		$key = trim( (string) $request->get_header( 'x_notion_key' ) );
		if ( '' === $key ) {
			return new WP_Error(
				'cortext_notion_missing_key',
				__( 'Missing Notion API key.', 'cortext' ),
				array( 'status' => 400 )
			);
		}
		return new Client( $key );
	}

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

	private function data_source_title( array $data_source ): string {
		$fragments = $data_source['title'] ?? array();
		if ( ! is_array( $fragments ) ) {
			return '';
		}
		$parts = array();
		foreach ( $fragments as $fragment ) {
			if ( isset( $fragment['plain_text'] ) ) {
				$parts[] = (string) $fragment['plain_text'];
			}
		}
		return implode( '', $parts );
	}
}
