<?php
/**
 * REST endpoints for collection-level settings.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Rest;

use Cortext\PostType\Document;
use WP_Error;
use WP_Post;
use WP_REST_Request;
use WP_REST_Response;

final class CollectionsController {

	private const NAMESPACE            = 'cortext/v1';
	private const VIEW_CONFIG_META_KEY = 'cortext_view_config';
	private const DEFAULT_VIEW_SLUG    = 'default';

	public function register(): void {
		add_action( 'rest_api_init', array( $this, 'register_routes' ) );
	}

	public function register_routes(): void {
		register_rest_route(
			self::NAMESPACE,
			'/collections/(?P<collection_id>\d+)/views',
			array(
				array(
					'methods'             => 'GET',
					'callback'            => array( $this, 'get_views' ),
					'permission_callback' => array( $this, 'can_read_views' ),
					'args'                => array(
						'collection_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
				array(
					'methods'             => 'PUT',
					'callback'            => array( $this, 'update_views' ),
					'permission_callback' => array( $this, 'can_update_views' ),
					'args'                => array(
						'collection_id' => array(
							'type'     => 'integer',
							'required' => true,
						),
					),
				),
			)
		);
	}

	public function can_read_views( WP_REST_Request $request ): bool|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$collection    = $this->require_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		return current_user_can( 'edit_post', $collection_id );
	}

	public function can_update_views( WP_REST_Request $request ): bool|WP_Error {
		return $this->can_read_views( $request );
	}

	public function get_views( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$collection    = $this->require_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		return new WP_REST_Response( $this->stored_view_config( $collection_id ), 200 );
	}

	public function update_views( WP_REST_Request $request ): WP_REST_Response|WP_Error {
		$collection_id = (int) $request->get_param( 'collection_id' );
		$collection    = $this->require_collection( $collection_id );
		if ( is_wp_error( $collection ) ) {
			return $collection;
		}

		$payload = $request->get_json_params();
		if ( ! is_array( $payload ) ) {
			$payload = $request->get_body_params();
		}
		$view_config = $this->normalize_view_config( is_array( $payload ) ? $payload : array(), true );
		if ( is_wp_error( $view_config ) ) {
			return $view_config;
		}

		$encoded = wp_json_encode( $view_config );
		if ( ! is_string( $encoded ) ) {
			return new WP_Error(
				'cortext_collection_view_config_invalid',
				__( 'View configuration could not be saved.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		update_post_meta( $collection_id, self::VIEW_CONFIG_META_KEY, wp_slash( $encoded ) );

		return new WP_REST_Response( $view_config, 200 );
	}

	private function require_collection( int $collection_id ): WP_Post|WP_Error {
		$collection = get_post( $collection_id );
		if ( ! $collection instanceof WP_Post || ! Document::is_collection_post( $collection ) ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return $collection;
	}

	/**
	 * Active view stored for a collection.
	 *
	 * @param int $collection_id Collection document ID.
	 * @return array|null Null when the collection has no saved view config.
	 */
	public function stored_active_view( int $collection_id ): ?array {
		$raw = $this->stored_raw_view_config( $collection_id );
		return null === $raw ? null : $this->active_view_from_config( $raw );
	}

	/**
	 * Active view of a config shaped like the endpoint payload, which the
	 * data-view block attributes share, merged over its default view.
	 *
	 * @param array $config View config.
	 * @return array|null Null when the config has no view list.
	 */
	public function active_view_from_config( array $config ): ?array {
		if ( ! isset( $config['view_list'] ) || ! is_array( $config['view_list'] ) ) {
			return null;
		}

		$view_config = $this->normalize_view_config( $config, false );
		if ( is_wp_error( $view_config ) ) {
			return null;
		}

		foreach ( $view_config['view_list'] as $view_entry ) {
			if ( $view_entry['slug'] === $view_config['active_view'] ) {
				return $view_entry['view'];
			}
		}

		return null;
	}

	private function stored_raw_view_config( int $collection_id ): ?array {
		$raw = get_post_meta( $collection_id, self::VIEW_CONFIG_META_KEY, true );
		if ( ! is_string( $raw ) || '' === trim( $raw ) ) {
			return null;
		}

		$decoded = json_decode( $raw, true );
		return is_array( $decoded ) ? $decoded : null;
	}

	private function stored_view_config( int $collection_id ): array {
		$raw = $this->stored_raw_view_config( $collection_id );
		if ( null === $raw ) {
			return $this->default_view_config();
		}

		$view_config = $this->normalize_view_config( $raw, false );
		if ( is_wp_error( $view_config ) ) {
			return $this->default_view_config();
		}

		return $view_config;
	}

	private function normalize_view_config( array $payload, bool $strict ): array|WP_Error {
		$default_view = $this->default_view();
		if ( array_key_exists( 'default_view', $payload ) ) {
			if (
				! is_array( $payload['default_view'] ) ||
				array_is_list( $payload['default_view'] )
			) {
				return $strict
					? new WP_Error(
						'cortext_collection_default_view_invalid',
						__( 'Default view must be an object.', 'cortext' ),
						array( 'status' => 400 )
					)
					: $this->default_view_config();
			}
			$default_view = $this->json_safe_array( $payload['default_view'] );
			if ( is_wp_error( $default_view ) ) {
				return $default_view;
			}
			$default_view = $this->strip_view_runtime_state( $default_view );
		}

		$default_layouts = $this->default_layouts();
		if ( array_key_exists( 'default_layouts', $payload ) ) {
			if (
				! is_array( $payload['default_layouts'] ) ||
				array_is_list( $payload['default_layouts'] )
			) {
				return $strict
					? new WP_Error(
						'cortext_collection_default_layouts_invalid',
						__( 'Default layouts must be an object.', 'cortext' ),
						array( 'status' => 400 )
					)
					: $this->default_view_config();
			}
			$default_layouts = $this->json_safe_array( $payload['default_layouts'] );
			if ( is_wp_error( $default_layouts ) ) {
				return $default_layouts;
			}
		}

		$views_payload = $payload['view_list'] ?? null;
		if (
			! is_array( $views_payload ) ||
			! array_is_list( $views_payload ) ||
			0 === count( $views_payload )
		) {
			return $strict
				? new WP_Error(
					'cortext_collection_view_list_required',
					__( 'At least one view is required.', 'cortext' ),
					array( 'status' => 400 )
				)
				: $this->default_view_config();
		}

		$view_list = array();
		$slugs     = array();

		foreach ( $views_payload as $index => $raw_view ) {
			if ( ! is_array( $raw_view ) ) {
				if ( $strict ) {
					return new WP_Error(
						'cortext_collection_view_invalid',
						__( 'Each view must be an object.', 'cortext' ),
						array( 'status' => 400 )
					);
				}
				continue;
			}

			$slug = isset( $raw_view['slug'] )
				? sanitize_key( (string) $raw_view['slug'] )
				: '';
			if ( '' === $slug ) {
				if ( $strict ) {
					return new WP_Error(
						'cortext_collection_view_slug_required',
						__( 'Each view needs a slug.', 'cortext' ),
						array( 'status' => 400 )
					);
				}
				$slug = 0 === count( $view_list )
					? self::DEFAULT_VIEW_SLUG
					: $this->next_fallback_slug( $slugs );
			}

			if ( isset( $slugs[ $slug ] ) ) {
				if ( $strict ) {
					return new WP_Error(
						'cortext_collection_view_slug_duplicate',
						__( 'View slugs must be unique.', 'cortext' ),
						array( 'status' => 400 )
					);
				}
				$slug = $this->next_fallback_slug( $slugs );
			}

			$view = isset( $raw_view['view'] ) && is_array( $raw_view['view'] )
				? $raw_view['view']
				: null;
			if ( ! is_array( $view ) || array_is_list( $view ) ) {
				if ( $strict ) {
					return new WP_Error(
						'cortext_collection_view_config_invalid',
						__( 'Each view needs a configuration object.', 'cortext' ),
						array( 'status' => 400 )
					);
				}
				$view = $default_view;
			}

			$view = $this->json_safe_array( $view );
			if ( is_wp_error( $view ) ) {
				return $view;
			}
			$view = $this->merge_view_config( $default_view, $view );
			$view = $this->strip_view_runtime_state( $view );

			$title = isset( $raw_view['title'] )
				? trim( sanitize_text_field( (string) $raw_view['title'] ) )
				: '';
			if ( '' === $title ) {
				$title = 0 === (int) $index
					? __( 'Table', 'cortext' )
					: __( 'View', 'cortext' );
			}

			$slugs[ $slug ] = true;
			$view_list[]    = array(
				'slug'  => $slug,
				'title' => $title,
				'view'  => $view,
			);
		}

		if ( count( $view_list ) < 1 ) {
			return $strict
				? new WP_Error(
					'cortext_collection_view_list_required',
					__( 'At least one view is required.', 'cortext' ),
					array( 'status' => 400 )
				)
				: $this->default_view_config();
		}

		$active_view = isset( $payload['active_view'] )
			? sanitize_key( (string) $payload['active_view'] )
			: '';
		if ( ! isset( $slugs[ $active_view ] ) ) {
			$active_view = $view_list[0]['slug'];
		}

		return array(
			'default_view'    => $default_view,
			'default_layouts' => $default_layouts,
			'active_view'     => $active_view,
			'view_list'       => $view_list,
		);
	}

	private function next_fallback_slug( array $used_slugs ): string {
		$index = 1;
		$slug  = 'view-' . $index;
		while ( isset( $used_slugs[ $slug ] ) || self::DEFAULT_VIEW_SLUG === $slug ) {
			++$index;
			$slug = 'view-' . $index;
		}

		return $slug;
	}

	private function json_safe_array( array $value ): array|WP_Error {
		$encoded = wp_json_encode( $value );
		if ( ! is_string( $encoded ) ) {
			return new WP_Error(
				'cortext_collection_view_config_invalid',
				__( 'View configuration could not be saved.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		$decoded = json_decode( $encoded, true );
		if ( ! is_array( $decoded ) || array_is_list( $decoded ) ) {
			return new WP_Error(
				'cortext_collection_view_config_invalid',
				__( 'View configuration must be an object.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		return $decoded;
	}

	private function strip_view_runtime_state( array $view ): array {
		unset( $view['page'] );
		return $view;
	}

	private function merge_view_config( array $default_view, array $view ): array {
		$merged = array_merge( $default_view, $view );
		if (
			isset( $default_view['layout'] ) &&
			is_array( $default_view['layout'] ) &&
			! array_is_list( $default_view['layout'] ) &&
			isset( $view['layout'] ) &&
			is_array( $view['layout'] ) &&
			! array_is_list( $view['layout'] )
		) {
			$merged['layout'] = array_merge(
				$default_view['layout'],
				$view['layout']
			);
		}

		return $merged;
	}

	private function default_view_config(): array {
		$default_view = $this->default_view();
		return array(
			'default_view'    => $default_view,
			'default_layouts' => $this->default_layouts(),
			'active_view'     => self::DEFAULT_VIEW_SLUG,
			'view_list'       => array(
				array(
					'slug'  => self::DEFAULT_VIEW_SLUG,
					'title' => __( 'Table', 'cortext' ),
					'view'  => $default_view,
				),
			),
		);
	}

	/**
	 * Partial views applied when switching layout, in the shape DataViews
	 * `defaultLayouts` and core's entity view config use.
	 *
	 * @return array
	 */
	private function default_layouts(): array {
		return array(
			'table' => array( 'layout' => array( 'density' => 'compact' ) ),
			'grid'  => array( 'layout' => array( 'previewSize' => 230 ) ),
			'list'  => array(),
		);
	}

	private function default_view(): array {
		return array(
			'type'          => 'table',
			'fields'        => array(),
			'sort'          => null,
			'filters'       => array(),
			'search'        => '',
			'calculations'  => array(),
			'perPage'       => 25,
			'layout'        => array( 'density' => 'compact' ),
			'rowDetailMode' => 'side',
		);
	}
}
