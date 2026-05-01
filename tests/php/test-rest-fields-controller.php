<?php
/**
 * Tests for Cortext\Rest\FieldsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\Rest\FieldsController;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Fields_Controller extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$this->unregister_dynamic_collection_post_types();
		( new Collection() )->register_post_type();
		( new Field() )->register_post_type();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new FieldsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		wp_set_current_user( 0 );

		parent::tear_down();
	}

	public function test_creates_field_and_attaches_to_collection(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Tasks', 'tasks' );

		$response = $this->create_field(
			$collection_id,
			array(
				'title' => 'Status',
				'type'  => 'text',
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$data     = $response->get_data();
		$field_id = (int) $data['id'];

		$this->assertGreaterThan( 0, $field_id );
		$this->assertSame( 'Status', get_post( $field_id )->post_title );
		$this->assertSame( 'text', get_post_meta( $field_id, 'type', true ) );
		$this->assertSame(
			array( (string) $field_id ),
			array_map( 'strval', get_post_meta( $collection_id, 'fields', false ) )
		);
	}

	public function test_creates_field_with_select_options_serialized_as_json(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Tags', 'tags' );

		$response = $this->create_field(
			$collection_id,
			array(
				'title'   => 'Priority',
				'type'    => 'select',
				'options' => array(
					array(
						'value' => 'high',
						'label' => 'High',
					),
					array(
						'value' => 'low',
						'label' => 'Low',
					),
				),
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$field_id = (int) $response->get_data()['id'];
		$options  = json_decode( get_post_meta( $field_id, 'options', true ), true );

		$this->assertSame(
			array(
				array(
					'value' => 'high',
					'label' => 'High',
				),
				array(
					'value' => 'low',
					'label' => 'Low',
				),
			),
			$options
		);
	}

	public function test_create_rejects_invalid_type(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Items', 'items' );

		$response = $this->create_field(
			$collection_id,
			array(
				'title' => 'Bogus',
				'type'  => 'unknown_type',
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			array(),
			get_posts(
				array(
					'post_type'      => Field::POST_TYPE,
					'post_status'    => 'any',
					'fields'         => 'ids',
					'posts_per_page' => -1,
				)
			)
		);
	}

	public function test_create_rejects_empty_title(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Empty', 'empty' );

		$response = $this->create_field(
			$collection_id,
			array(
				'title' => ' ',
				'type'  => 'text',
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_create_rejects_when_collection_missing(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );

		$response = $this->create_field(
			999999,
			array(
				'title' => 'Orphan',
				'type'  => 'text',
			)
		);

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_create_requires_edit_capability(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$collection_id = $this->create_collection_with_slug( 'Locked', 'locked' );

		$response = $this->create_field(
			$collection_id,
			array(
				'title' => 'Status',
				'type'  => 'text',
			)
		);

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_create_rolls_back_field_when_attach_fails(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Attach Fails', 'attach' );

		// Force `add_post_meta` for `fields` on this collection to return false.
		add_filter(
			'add_post_metadata',
			function ( $check, $object_id, $meta_key ) use ( $collection_id ) {
				if ( (int) $object_id === $collection_id && 'fields' === $meta_key ) {
					return false;
				}
				return $check;
			},
			10,
			3
		);

		$response = $this->create_field(
			$collection_id,
			array(
				'title' => 'Will Fail',
				'type'  => 'text',
			)
		);

		$this->assertSame( 500, $response->get_status() );
		$this->assertSame(
			array(),
			get_posts(
				array(
					'post_type'      => Field::POST_TYPE,
					'post_status'    => 'any',
					'fields'         => 'ids',
					'posts_per_page' => -1,
				)
			),
			'Orphan field must be force-deleted when attach fails.'
		);
	}

	public function test_duplicate_inserts_after_source_with_copy_title(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Schemas', 'schemas' );

		$first_id  = $this->create_field(
			$collection_id,
			array(
				'title' => 'A',
				'type'  => 'text',
			)
		)->get_data()['id'];
		$second_id = $this->create_field(
			$collection_id,
			array(
				'title' => 'B',
				'type'  => 'text',
			)
		)->get_data()['id'];
		$third_id  = $this->create_field(
			$collection_id,
			array(
				'title' => 'C',
				'type'  => 'text',
			)
		)->get_data()['id'];

		$response = $this->duplicate_field( $collection_id, (int) $second_id );

		$this->assertSame( 201, $response->get_status() );

		$copy_id = (int) $response->get_data()['id'];

		$this->assertSame( 'Copy of B', get_post( $copy_id )->post_title );
		$this->assertSame(
			array(
				(string) $first_id,
				(string) $second_id,
				(string) $copy_id,
				(string) $third_id,
			),
			array_map( 'strval', get_post_meta( $collection_id, 'fields', false ) )
		);
	}

	public function test_duplicate_clones_meta(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Clone Meta', 'clone' );

		$source_id = $this->create_field(
			$collection_id,
			array(
				'title'   => 'Priority',
				'type'    => 'select',
				'options' => array(
					array(
						'value' => 'high',
						'label' => 'High',
					),
				),
			)
		)->get_data()['id'];

		$copy_id = (int) $this->duplicate_field( $collection_id, (int) $source_id )->get_data()['id'];

		$this->assertSame( 'select', get_post_meta( $copy_id, 'type', true ) );
		$this->assertSame(
			get_post_meta( (int) $source_id, 'options', true ),
			get_post_meta( $copy_id, 'options', true )
		);
	}

	public function test_duplicate_preserves_related_collection_id(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Tasks', 'tasks-r' );
		$target_id     = $this->create_collection_with_slug( 'People', 'people-r' );

		// Relation fields aren't creatable through PR D's create route
		// (its `type` enum doesn't include `relation`), but they exist in
		// the DB when imported from external sources. Insert directly so
		// the duplicate route sees a field with `related_collection_id`.
		$source_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Assignee',
				'meta_input'  => array(
					'type'                  => 'relation',
					'related_collection_id' => $target_id,
				),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $source_id );

		$copy_id = (int) $this->duplicate_field( $collection_id, $source_id )
			->get_data()['id'];

		$this->assertSame( 'relation', get_post_meta( $copy_id, 'type', true ) );
		$this->assertSame(
			(string) $target_id,
			(string) get_post_meta( $copy_id, 'related_collection_id', true )
		);
	}

	public function test_duplicate_rolls_back_when_meta_write_fails(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Splice Fails', 'splice-fail' );

		$source_id = (int) $this->create_field(
			$collection_id,
			array(
				'title' => 'Source',
				'type'  => 'text',
			)
		)->get_data()['id'];

		// Fail the splice's add_post_meta for the new field's ID
		// (auto-increment post IDs are monotonic, so the copy's ID is
		// always higher than the source's). Existing IDs in the rollback
		// path stay <= source_id and write through.
		add_filter(
			'add_post_metadata',
			function ( $check, $object_id, $meta_key, $meta_value ) use ( $collection_id, $source_id ) {
				if ( (int) $object_id !== $collection_id || 'fields' !== $meta_key ) {
					return $check;
				}
				if ( (int) $meta_value > $source_id ) {
					return false;
				}
				return $check;
			},
			10,
			4
		);

		$response = $this->duplicate_field( $collection_id, $source_id );

		$this->assertSame( 500, $response->get_status() );
		$this->assertSame(
			array( $source_id ),
			array_map(
				'intval',
				get_post_meta( $collection_id, 'fields', false )
			),
			'Collection field list must be restored to its pre-duplicate state.'
		);
		$source_post = get_post( $source_id );
		$this->assertInstanceOf(
			\WP_Post::class,
			$source_post,
			'Source field must survive a failed duplicate.'
		);
		$this->assertSame( Field::POST_TYPE, $source_post->post_type );
	}

	public function test_duplicate_rolls_back_when_source_id_disappears_before_attach(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Race', 'race' );

		$source_id = (int) $this->create_field(
			$collection_id,
			array(
				'title' => 'Source',
				'type'  => 'text',
			)
		)->get_data()['id'];

		// Simulate a race: duplicate()'s validation reads `meta.fields`
		// and sees the source ID; attach_field re-reads (call #2+) and
		// the source is gone. attach_field must return false so
		// insert_and_attach can force-delete the orphan.
		$reads = 0;
		add_filter(
			'get_post_metadata',
			function ( $value, $object_id, $meta_key ) use ( &$reads, $collection_id ) {
				if ( (int) $object_id !== $collection_id || 'fields' !== $meta_key ) {
					return $value;
				}
				$reads++;
				if ( $reads >= 2 ) {
					return array();
				}
				return $value;
			},
			10,
			4
		);

		$response = $this->duplicate_field( $collection_id, $source_id );

		$this->assertSame( 500, $response->get_status() );
		$source_post = get_post( $source_id );
		$this->assertInstanceOf(
			\WP_Post::class,
			$source_post,
			'Source field must survive a failed duplicate.'
		);
		$this->assertSame( Field::POST_TYPE, $source_post->post_type );
	}

	public function test_duplicate_fails_when_source_not_in_collection(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$first_id  = $this->create_collection_with_slug( 'First', 'first-d' );
		$second_id = $this->create_collection_with_slug( 'Second', 'second-d' );

		$source_id = $this->create_field(
			$first_id,
			array(
				'title' => 'In First',
				'type'  => 'text',
			)
		)->get_data()['id'];

		$response = $this->duplicate_field( $second_id, (int) $source_id );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_duplicate_fails_when_source_field_missing(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Missing Source', 'missing-src' );

		$response = $this->duplicate_field( $collection_id, 999999 );

		$this->assertSame( 404, $response->get_status() );
	}

	public function test_duplicate_requires_edit_capability(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Auth Test', 'auth-d' );
		$source_id     = $this->create_field(
			$collection_id,
			array(
				'title' => 'Title',
				'type'  => 'text',
			)
		)->get_data()['id'];

		wp_set_current_user( $this->create_user( 'subscriber' ) );
		$response = $this->duplicate_field( $collection_id, (int) $source_id );

		$this->assertSame( 403, $response->get_status() );
	}

	private function create_field( int $collection_id, array $body ) {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/collections/{$collection_id}/fields"
		);
		$request->set_param( 'collection_id', $collection_id );
		foreach ( $body as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return rest_do_request( $request );
	}

	private function duplicate_field( int $collection_id, int $field_id ) {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/collections/{$collection_id}/fields/{$field_id}/duplicate"
		);
		$request->set_param( 'collection_id', $collection_id );
		$request->set_param( 'field_id', $field_id );
		return rest_do_request( $request );
	}

	private function create_collection_with_slug( string $title, string $slug ): int {
		return (int) wp_insert_post(
			array(
				'post_type'   => Collection::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => $title,
				'meta_input'  => array( 'slug' => $slug ),
			)
		);
	}

	private function create_user( string $role ): int {
		return (int) wp_insert_user(
			array(
				'user_login' => uniqid( 'cortext_', false ),
				'user_pass'  => 'password',
				'role'       => $role,
			)
		);
	}

	private function unregister_dynamic_collection_post_types(): void {
		foreach ( get_post_types() as $post_type ) {
			if (
				str_starts_with( $post_type, CollectionEntries::CPT_PREFIX ) &&
				! in_array( $post_type, array( Collection::POST_TYPE, Field::POST_TYPE ), true )
			) {
				unregister_post_type( $post_type );
			}
		}
	}
}
