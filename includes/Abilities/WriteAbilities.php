<?php
/**
 * Registers the abilities that change Cortext documents.
 *
 * Each one runs the REST route the app uses for the same change, so the
 * route's permission checks, read-only rules and property validation apply
 * unchanged. Each one takes a single document (archive and Trash bring its
 * subpages along, as they do in the app), and none deletes permanently.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Abilities;

use Cortext\Documents;
use Cortext\PostType\ArchiveCascade;
use Cortext\PostType\Document;
use WP_Error;
use WP_Post;

defined( 'ABSPATH' ) || exit;

final class WriteAbilities {

	private const DOCUMENTS_ROUTE = '/wp/v2/crtxt_documents';

	/** Each run adds a new document. */
	private const CREATES = array(
		'annotations'  => array(
			'readonly'    => false,
			'destructive' => false,
			'idempotent'  => false,
		),
		'show_in_rest' => true,
	);

	/** Running it again with the same input changes nothing more. */
	private const CHANGES = array(
		'annotations'  => array(
			'readonly'    => false,
			'destructive' => false,
			'idempotent'  => true,
		),
		'show_in_rest' => true,
	);

	/** Takes the document and its subpages out of the workspace. */
	private const REMOVES = array(
		'annotations'  => array(
			'readonly'    => false,
			'destructive' => true,
			'idempotent'  => true,
		),
		'show_in_rest' => true,
	);

	public function register(): void {
		add_action( 'wp_abilities_api_init', array( $this, 'register_abilities' ) );
	}

	public function register_abilities(): void {
		$id         = array(
			'type'        => 'integer',
			'minimum'     => 1,
			'description' => __( 'ID of the document.', 'cortext' ),
		);
		$content    = array(
			'type'        => 'string',
			'description' => __( 'Content as block markup.', 'cortext' ),
		);
		$properties = array(
			'type'        => 'object',
			'description' => __( 'Property values keyed by property key (field-<id>), as listed by cortext/list-collections.', 'cortext' ),
		);
		$parent     = array(
			'type'        => 'integer',
			'minimum'     => 0,
			'description' => __( 'ID of the document to put it under, or 0 for the top level.', 'cortext' ),
		);
		$by_id      = static fn( array $extra = array(), array $required = array( 'id' ) ): array => array(
			'type'                 => 'object',
			'properties'           => array( 'id' => $id ) + $extra,
			'required'             => $required,
			'additionalProperties' => false,
		);
		$ids_output = static fn( string $key ): array => array(
			'type'       => 'object',
			'properties' => array(
				$key => array(
					'type'  => 'array',
					'items' => array( 'type' => 'integer' ),
				),
			),
		);
		$document   = array(
			'type'       => 'object',
			'properties' => array(
				'id'     => array( 'type' => 'integer' ),
				'title'  => array( 'type' => 'string' ),
				'path'   => array( 'type' => 'string' ),
				'parent' => array( 'type' => 'integer' ),
			),
		);

		$this->add(
			'cortext/create-page',
			__( 'Create document', 'cortext' ),
			__( 'Creates a document, at the top level or under another document.', 'cortext' ),
			array(
				'type'                 => 'object',
				'properties'           => array(
					'title'   => array( 'type' => 'string' ),
					'content' => $content,
					'parent'  => $parent,
				),
				'additionalProperties' => false,
				'default'              => array(),
			),
			$document,
			'create_page',
			'can_create',
			self::CREATES
		);

		$this->add(
			'cortext/create-row',
			__( 'Add a document to a collection', 'cortext' ),
			__( 'Creates a document in a collection, with optional property values.', 'cortext' ),
			array(
				'type'                 => 'object',
				'properties'           => array(
					'collection' => array(
						'type'        => 'integer',
						'minimum'     => 1,
						'description' => __( 'ID of the collection.', 'cortext' ),
					),
					'title'      => array( 'type' => 'string' ),
					'properties' => $properties,
				),
				'required'             => array( 'collection' ),
				'additionalProperties' => false,
			),
			$document,
			'create_row',
			'can_create_row',
			self::CREATES
		);

		$this->add(
			'cortext/update-document',
			__( 'Change document properties', 'cortext' ),
			__( 'Changes the property values of a document in a collection. Properties left out keep their values.', 'cortext' ),
			$by_id( array( 'properties' => $properties ), array( 'id', 'properties' ) ),
			$document,
			'update_document',
			'can_edit',
			self::CHANGES
		);

		$this->add(
			'cortext/rename-document',
			__( 'Rename document', 'cortext' ),
			__( 'Changes the title of a document.', 'cortext' ),
			$by_id( array( 'title' => array( 'type' => 'string' ) ), array( 'id', 'title' ) ),
			$document,
			'rename_document',
			'can_edit',
			self::CHANGES
		);

		$this->add(
			'cortext/move-document',
			__( 'Move document', 'cortext' ),
			__( 'Puts a document under another document, or at the top level. The documents inside it move with it.', 'cortext' ),
			$by_id( array( 'parent' => $parent ), array( 'id', 'parent' ) ),
			$document,
			'move_document',
			'can_edit',
			self::CHANGES
		);

		$this->add(
			'cortext/archive-document',
			__( 'Archive document', 'cortext' ),
			__( 'Archives a document and the documents inside it. Archived documents keep their content but can\'t be edited until they are unarchived.', 'cortext' ),
			$by_id(),
			$ids_output( 'archived' ),
			'archive_document',
			'can_archive',
			self::CHANGES
		);

		$this->add(
			'cortext/unarchive-document',
			__( 'Unarchive document', 'cortext' ),
			__( 'Brings an archived document and the documents inside it back.', 'cortext' ),
			$by_id(),
			$ids_output( 'restored' ),
			'unarchive_document',
			'can_unarchive',
			self::CHANGES
		);

		$this->add(
			'cortext/trash-document',
			__( 'Move document to Trash', 'cortext' ),
			__( 'Moves a document and the documents inside it to Trash, where they can be restored from. It never deletes permanently.', 'cortext' ),
			$by_id(),
			$ids_output( 'trashed' ),
			'trash_document',
			'can_trash',
			self::REMOVES
		);
	}

	/**
	 * Same gate as creating a document through REST.
	 */
	public function can_create(): bool {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Adding a row changes its collection, so the user has to be able to
	 * edit the collection too.
	 *
	 * @param array<string,mixed> $input Ability input.
	 */
	public function can_create_row( array $input ): bool {
		return $this->can_create() && current_user_can( 'edit_post', (int) $input['collection'] );
	}

	/**
	 * Same gate as updating a document through REST.
	 *
	 * @param array<string,mixed> $input Ability input.
	 */
	public function can_edit( array $input ): bool {
		return current_user_can( 'edit_post', (int) $input['id'] );
	}

	/**
	 * Same gate as the archive route: every document archived with it has
	 * to be editable.
	 *
	 * @param array<string,mixed> $input Ability input.
	 */
	public function can_archive( array $input ): bool {
		return ( new ArchiveCascade() )->current_user_can_archive( (int) $input['id'] );
	}

	/**
	 * Same gate as the unarchive route.
	 *
	 * @param array<string,mixed> $input Ability input.
	 */
	public function can_unarchive( array $input ): bool {
		return ( new ArchiveCascade() )->current_user_can_unarchive( (int) $input['id'] );
	}

	/**
	 * Same gate as moving a document to Trash through REST.
	 *
	 * @param array<string,mixed> $input Ability input.
	 */
	public function can_trash( array $input ): bool {
		return current_user_can( 'delete_post', (int) $input['id'] );
	}

	/**
	 * Untitled pages start as drafts, like the ones made in the sidebar, so
	 * their address follows the title they get later.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array<string,mixed>|WP_Error
	 */
	public function create_page( array $input ) {
		$invalid = $this->invalid_parent( (int) ( $input['parent'] ?? 0 ) );
		if ( null !== $invalid ) {
			return $invalid;
		}

		$status = '' === trim( (string) ( $input['title'] ?? '' ) ) ? 'draft' : 'private';

		return $this->save( self::DOCUMENTS_ROUTE, array( 'status' => $status ) + $input );
	}

	/**
	 * Creates the row the way the collection table does.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array<string,mixed>|WP_Error
	 */
	public function create_row( array $input ) {
		$collection_id = (int) $input['collection'];
		if ( ! Document::is_collection( $collection_id ) || ! self::is_active( $collection_id ) ) {
			return new WP_Error(
				'cortext_collection_not_found',
				__( 'Collection not found.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		$params = array(
			'status'        => 'private',
			'title'         => $input['title'] ?? '',
			'cortext_trait' => $collection_id,
		);
		if ( ! empty( $input['properties'] ) ) {
			$invalid = $this->invalid_properties( $input['properties'], $collection_id );
			if ( null !== $invalid ) {
				return $invalid;
			}
			$params['meta'] = $input['properties'];
		}

		return $this->save( self::DOCUMENTS_ROUTE, $params );
	}

	/**
	 * Sends only the given property values, so the ones left out stay as
	 * they are. Content isn't accepted: replacing it would drop the header
	 * blocks and a collection's own view.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array<string,mixed>|WP_Error
	 */
	public function update_document( array $input ) {
		$post       = get_post( (int) $input['id'] );
		$collection = $post instanceof WP_Post ? ( new Documents() )->find_trait_for_document( $post ) : null;
		$invalid    = $this->invalid_properties( $input['properties'], $collection instanceof WP_Post ? $collection->ID : 0 );
		if ( null !== $invalid ) {
			return $invalid;
		}

		return $this->save( $this->document_route( $input ), array( 'meta' => $input['properties'] ) );
	}

	/**
	 * Naming a draft makes it private, like a rename in the app, so its
	 * address follows the new title.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array<string,mixed>|WP_Error
	 */
	public function rename_document( array $input ) {
		$params = array( 'title' => $input['title'] );
		if ( 'draft' === get_post_status( (int) $input['id'] ) ) {
			$params['status'] = 'private';
		}

		return $this->save( $this->document_route( $input ), $params );
	}

	/**
	 * Sends only the parent, so a locked document can still be moved.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array<string,mixed>|WP_Error
	 */
	public function move_document( array $input ) {
		$id        = (int) $input['id'];
		$parent_id = (int) $input['parent'];

		$invalid = $this->invalid_parent( $parent_id );
		if ( null !== $invalid ) {
			return $invalid;
		}

		// Core moves a document that would end up under itself to the top
		// level without saying so, so the request is refused here instead.
		// The top level has no ancestors to check, and asking core for
		// them would read the global post's.
		if ( $parent_id > 0 && ( $parent_id === $id || in_array( $id, get_post_ancestors( $parent_id ), true ) ) ) {
			return new WP_Error(
				'cortext_invalid_parent',
				__( 'Couldn\'t move the document: it can\'t go inside itself or a document inside it.', 'cortext' ),
				array( 'status' => 400 )
			);
		}

		return $this->save( $this->document_route( $input ), array( 'parent' => $parent_id ) );
	}

	/**
	 * Runs the archive route.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array{archived: int[]}|WP_Error
	 */
	public function archive_document( array $input ) {
		$result = Abilities::dispatch( 'POST', "/cortext/v1/documents/{$input['id']}/archive" );

		return is_wp_error( $result ) ? $result : array( 'archived' => $result['archived'] );
	}

	/**
	 * Runs the unarchive route.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array{restored: int[]}|WP_Error
	 */
	public function unarchive_document( array $input ) {
		$result = Abilities::dispatch( 'POST', "/cortext/v1/documents/{$input['id']}/unarchive" );

		return is_wp_error( $result ) ? $result : array( 'restored' => $result['restored'] );
	}

	/**
	 * Deletes without `force`, which moves the document to Trash.
	 *
	 * @param array<string,mixed> $input Ability input.
	 * @return array{trashed: int[]}|WP_Error
	 */
	public function trash_document( array $input ) {
		$result = Abilities::dispatch( 'DELETE', $this->document_route( $input ) );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return array( 'trashed' => array_merge( array( (int) $result['id'] ), $result['cascade_deleted'] ?? array() ) );
	}

	/**
	 * A document can only go under a live Cortext document. Core accepts any
	 * post as parent, and the sidebar wouldn't show the result.
	 *
	 * @param int $parent_id Parent ID, 0 for the top level.
	 */
	private function invalid_parent( int $parent_id ): ?WP_Error {
		if ( 0 === $parent_id ) {
			return null;
		}

		$parent = get_post( $parent_id );
		if ( ! $parent instanceof WP_Post || ! post_type_supports( $parent->post_type, 'cortext-document' ) || ! self::is_active( $parent_id ) ) {
			return new WP_Error(
				'cortext_parent_not_found',
				__( 'Couldn\'t find the document to put it under.', 'cortext' ),
				array( 'status' => 404 )
			);
		}

		return null;
	}

	/**
	 * Property values are accepted only under the keys of the collection's
	 * own properties that can be set. The documents route would otherwise
	 * save other post meta it exposes, or skip unknown keys and calculated
	 * properties without saying so.
	 *
	 * @param array<string,mixed> $properties    Property values by key.
	 * @param int                 $collection_id Collection ID, 0 when the document isn't in one.
	 */
	private function invalid_properties( array $properties, int $collection_id ): ?WP_Error {
		$types = array();
		foreach ( $collection_id > 0 ? Document::collection_field_ids( $collection_id ) : array() as $field_id ) {
			$types[ "field-{$field_id}" ] = (string) get_post_meta( $field_id, 'type', true );
		}

		foreach ( array_keys( $properties ) as $key ) {
			if ( ! isset( $types[ $key ] ) ) {
				return new WP_Error(
					'cortext_unknown_property',
					/* translators: %s: property key, such as field-12. */
					sprintf( __( 'Couldn\'t save the properties: "%s" isn\'t a property of this collection.', 'cortext' ), $key ),
					array(
						'status' => 400,
						'key'    => $key,
					)
				);
			}

			if ( in_array( $types[ $key ], array( 'rollup', 'formula' ), true ) ) {
				return new WP_Error(
					'cortext_calculated_property',
					/* translators: %s: property key, such as field-12. */
					sprintf( __( 'Couldn\'t save the properties: "%s" is calculated and can\'t be set.', 'cortext' ), $key ),
					array(
						'status' => 400,
						'key'    => $key,
					)
				);
			}
		}

		return null;
	}

	/**
	 * Whether the document is live: not archived or in Trash.
	 *
	 * @param int $id Document ID.
	 */
	private static function is_active( int $id ): bool {
		return in_array( get_post_status( $id ), Documents::DEFAULT_STATUSES, true );
	}

	/**
	 * Registers one write ability in the Cortext category.
	 *
	 * @param string              $name          Ability name.
	 * @param string              $label         Ability label.
	 * @param string              $description   Ability description.
	 * @param array<string,mixed> $input_schema  Input schema.
	 * @param array<string,mixed> $output_schema Output schema.
	 * @param string              $execute       Method that runs it.
	 * @param string              $permission    Method that checks permission.
	 * @param array<string,mixed> $meta          Annotations and REST exposure.
	 */
	private function add( string $name, string $label, string $description, array $input_schema, array $output_schema, string $execute, string $permission, array $meta ): void {
		wp_register_ability(
			$name,
			array(
				'label'               => $label,
				'description'         => $description,
				'category'            => Abilities::CATEGORY,
				'input_schema'        => $input_schema,
				'output_schema'       => $output_schema,
				'execute_callback'    => array( $this, $execute ),
				'permission_callback' => array( $this, $permission ),
				'meta'                => $meta,
			)
		);
	}

	/**
	 * Route of the document the input points at.
	 *
	 * @param array<string,mixed> $input Ability input.
	 */
	private function document_route( array $input ): string {
		return self::DOCUMENTS_ROUTE . '/' . (int) $input['id'];
	}

	/**
	 * Saves through the documents route and returns the document in the
	 * shape `cortext/search-documents` lists it.
	 *
	 * @param string              $route  Documents route, with an ID to update.
	 * @param array<string,mixed> $params Body params.
	 * @return array<string,mixed>|WP_Error
	 */
	private function save( string $route, array $params ) {
		$result = Abilities::dispatch( 'POST', $route, $params );
		if ( is_wp_error( $result ) ) {
			return $result;
		}

		return ( new Documents() )->format_document( get_post( (int) $result['id'] ) );
	}
}
