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

	public function test_create_preserves_color_from_palette_and_drops_unknown(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Palette', 'palette-c' );

		$response = $this->create_field(
			$collection_id,
			array(
				'title'   => 'Status',
				'type'    => 'select',
				'options' => array(
					array(
						'value' => 'todo',
						'label' => 'To do',
						'color' => 'blue',
					),
					array(
						'value' => 'doing',
						'label' => 'Doing',
						'color' => 'neon-magenta', // not in palette
					),
				),
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$field_id = (int) $response->get_data()['id'];
		$options  = json_decode( get_post_meta( $field_id, 'options', true ), true );

		$this->assertSame( 'blue', $options[0]['color'] );
		$this->assertArrayNotHasKey( 'color', $options[1] );
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

	public function test_create_relation_creates_reverse_field_and_links_pair(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$source_collection_id = $this->create_collection_with_slug( 'Tasks', 'tasks-rel' );
		$target_collection_id = $this->create_collection_with_slug( 'People', 'people-rel' );

		$response = $this->create_field(
			$source_collection_id,
			array(
				'title'                 => 'Assignee',
				'type'                  => 'relation',
				'related_collection_id' => $target_collection_id,
				'relation_multiple'     => false,
				'reverse_title'         => 'Tasks',
				'reverse_multiple'      => true,
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$source_field_id = (int) $response->get_data()['id'];
		$target_fields   = array_map(
			'intval',
			get_post_meta( $target_collection_id, 'fields', false )
		);
		$this->assertCount( 1, $target_fields );

		$reverse_field_id = $target_fields[0];
		$this->assertSame( 'Assignee', get_post( $source_field_id )->post_title );
		$this->assertSame( 'Tasks', get_post( $reverse_field_id )->post_title );
		$this->assertSame(
			$reverse_field_id,
			(int) get_post_meta( $source_field_id, 'relation_reverse_field_id', true )
		);
		$this->assertSame(
			$source_field_id,
			(int) get_post_meta( $reverse_field_id, 'relation_reverse_field_id', true )
		);
		$this->assertSame(
			$target_collection_id,
			(int) get_post_meta( $source_field_id, 'related_collection_id', true )
		);
		$this->assertSame(
			$source_collection_id,
			(int) get_post_meta( $reverse_field_id, 'related_collection_id', true )
		);
		$this->assertSame( '0', get_post_meta( $source_field_id, 'relation_multiple', true ) );
		$this->assertSame( '1', get_post_meta( $reverse_field_id, 'relation_multiple', true ) );
	}

	public function test_create_relation_rolls_back_source_when_reverse_attach_fails(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$source_collection_id = $this->create_collection_with_slug( 'Tasks', 'tasks-rev-fail' );
		$target_collection_id = $this->create_collection_with_slug( 'People', 'people-rfail' );

		add_filter(
			'add_post_metadata',
			function ( $check, $object_id, $meta_key ) use ( $target_collection_id ) {
				if ( (int) $object_id === $target_collection_id && 'fields' === $meta_key ) {
					return false;
				}
				return $check;
			},
			10,
			3
		);

		$response = $this->create_field(
			$source_collection_id,
			array(
				'title'                 => 'Assignee',
				'type'                  => 'relation',
				'related_collection_id' => $target_collection_id,
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
			)
		);
		$this->assertSame( array(), get_post_meta( $source_collection_id, 'fields', false ) );
		$this->assertSame( array(), get_post_meta( $target_collection_id, 'fields', false ) );
	}

	public function test_create_rollup_validates_and_stores_config(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$source_collection_id = $this->create_collection_with_slug( 'Projects', 'projects-roll' );
		$target_collection_id = $this->create_collection_with_slug( 'Invoices', 'invoices-roll' );

		$relation_id = (int) $this->create_field(
			$source_collection_id,
			array(
				'title'                 => 'Invoices',
				'type'                  => 'relation',
				'related_collection_id' => $target_collection_id,
			)
		)->get_data()['id'];
		$amount_id   = (int) $this->create_field(
			$target_collection_id,
			array(
				'title' => 'Amount',
				'type'  => 'number',
			)
		)->get_data()['id'];
		$number_format = wp_json_encode(
			array(
				'style'    => 'currency',
				'decimals' => 2,
				'currency' => 'USD',
			)
		);
		update_post_meta( $amount_id, 'number_format', $number_format );

		$response = $this->create_field(
			$source_collection_id,
			array(
				'title'                    => 'Total',
				'type'                     => 'rollup',
				'rollup_relation_field_id' => $relation_id,
				'rollup_target_field_id'   => $amount_id,
				'rollup_aggregator'        => 'sum',
			)
		);

		$this->assertSame( 201, $response->get_status() );

		$rollup_id = (int) $response->get_data()['id'];
		$this->assertSame( 'rollup', get_post_meta( $rollup_id, 'type', true ) );
		$this->assertSame( $relation_id, (int) get_post_meta( $rollup_id, 'rollup_relation_field_id', true ) );
		$this->assertSame( $amount_id, (int) get_post_meta( $rollup_id, 'rollup_target_field_id', true ) );
		$this->assertSame( 'sum', get_post_meta( $rollup_id, 'rollup_aggregator', true ) );
		$this->assertSame( 'number', get_post_meta( $rollup_id, 'rollup_target_type', true ) );
		$this->assertSame( $number_format, get_post_meta( $rollup_id, 'rollup_target_number_format', true ) );
	}

	public function test_create_rollup_accepts_date_range_for_date_targets(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$source_collection_id = $this->create_collection_with_slug( 'Projects', 'projects-date-roll' );
		$target_collection_id = $this->create_collection_with_slug( 'Invoices', 'invoices-date-roll' );

		$relation_id = (int) $this->create_field(
			$source_collection_id,
			array(
				'title'                 => 'Invoices',
				'type'                  => 'relation',
				'related_collection_id' => $target_collection_id,
			)
		)->get_data()['id'];
		$date_id     = (int) $this->create_field(
			$target_collection_id,
			array(
				'title' => 'Due',
				'type'  => 'date',
			)
		)->get_data()['id'];

		$response = $this->create_field(
			$source_collection_id,
			array(
				'title'                    => 'Due range',
				'type'                     => 'rollup',
				'rollup_relation_field_id' => $relation_id,
				'rollup_target_field_id'   => $date_id,
				'rollup_aggregator'        => 'date_range',
			)
		);

		$this->assertSame( 201, $response->get_status() );
		$rollup_id = (int) $response->get_data()['id'];
		$this->assertSame( 'date_range', get_post_meta( $rollup_id, 'rollup_aggregator', true ) );
		$this->assertSame( 'date', get_post_meta( $rollup_id, 'rollup_target_type', true ) );
	}

	public function test_create_rollup_rejects_rollup_of_rollup(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$source_collection_id = $this->create_collection_with_slug( 'Projects', 'projects-ror' );
		$target_collection_id = $this->create_collection_with_slug( 'Invoices', 'invoices-ror' );

		$relation_id = (int) $this->create_field(
			$source_collection_id,
			array(
				'title'                 => 'Invoices',
				'type'                  => 'relation',
				'related_collection_id' => $target_collection_id,
			)
		)->get_data()['id'];
		$reverse_id  = (int) get_post_meta( $relation_id, 'relation_reverse_field_id', true );
		$amount_id   = (int) $this->create_field(
			$source_collection_id,
			array(
				'title' => 'Budget',
				'type'  => 'number',
			)
		)->get_data()['id'];
		$rollup_id   = (int) $this->create_field(
			$target_collection_id,
			array(
				'title'                    => 'Project budget',
				'type'                     => 'rollup',
				'rollup_relation_field_id' => $reverse_id,
				'rollup_target_field_id'   => $amount_id,
				'rollup_aggregator'        => 'sum',
			)
		)->get_data()['id'];

		$response = $this->create_field(
			$source_collection_id,
			array(
				'title'                    => 'Nested',
				'type'                     => 'rollup',
				'rollup_relation_field_id' => $relation_id,
				'rollup_target_field_id'   => $rollup_id,
				'rollup_aggregator'        => 'sum',
			)
		);

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame(
			'cortext_rollup_of_rollup_unsupported',
			$response->get_data()['code']
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

	public function test_duplicate_clones_format_meta(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Format Meta', 'format-meta' );

		$number_format = wp_json_encode(
			array(
				'style'    => 'currency',
				'decimals' => 2,
				'currency' => 'EUR',
			)
		);
		$date_format   = wp_json_encode(
			array(
				'style'  => 'us',
				'time'   => true,
				'hour12' => false,
			)
		);

		// Format meta is written via core-data after creation, so insert
		// the source field directly with the meta in place.
		$source_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Price',
				'meta_input'  => array(
					'type'          => 'number',
					'number_format' => $number_format,
					'date_format'   => $date_format,
				),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $source_id );

		$copy_id = (int) $this->duplicate_field( $collection_id, $source_id )
			->get_data()['id'];

		$this->assertSame(
			$number_format,
			get_post_meta( $copy_id, 'number_format', true )
		);
		$this->assertSame(
			$date_format,
			get_post_meta( $copy_id, 'date_format', true )
		);
	}

	public function test_duplicate_clones_rollup_target_display_meta(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Rollup Clone', 'rollup-clone' );
		$options       = wp_json_encode(
			array(
				array(
					'value' => 'paid',
					'label' => 'Paid',
					'color' => 'green',
				),
			)
		);

		$source_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Statuses',
				'meta_input'  => array(
					'type'                  => 'rollup',
					'rollup_aggregator'     => 'show_unique',
					'rollup_target_type'    => 'select',
					'rollup_target_options' => $options,
				),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $source_id );

		$copy_id = (int) $this->duplicate_field( $collection_id, $source_id )
			->get_data()['id'];

		$this->assertSame( 'rollup', get_post_meta( $copy_id, 'type', true ) );
		$this->assertSame( 'show_unique', get_post_meta( $copy_id, 'rollup_aggregator', true ) );
		$this->assertSame( 'select', get_post_meta( $copy_id, 'rollup_target_type', true ) );
		$this->assertSame( $options, get_post_meta( $copy_id, 'rollup_target_options', true ) );
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

	public function test_update_options_round_trips_label_color_order(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Update', 'update-o' );
		$field_id      = (int) $this->create_field(
			$collection_id,
			array(
				'title'   => 'Status',
				'type'    => 'select',
				'options' => array(
					array(
						'value' => 'todo',
						'label' => 'To do',
					),
				),
			)
		)->get_data()['id'];

		$response = $this->update_options(
			$field_id,
			array(
				'options' => array(
					array(
						'value' => 'doing',
						'label' => 'In progress',
						'color' => 'orange',
					),
					array(
						'value' => 'todo',
						'label' => 'To do',
						'color' => 'default',
					),
				),
			)
		);

		$this->assertSame( 200, $response->get_status() );

		$stored = json_decode( get_post_meta( $field_id, 'options', true ), true );

		$this->assertSame(
			array(
				array(
					'value' => 'doing',
					'label' => 'In progress',
					'color' => 'orange',
				),
				array(
					'value' => 'todo',
					'label' => 'To do',
					'color' => 'default',
				),
			),
			$stored
		);
	}

	public function test_update_options_strips_unknown_color(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Strip', 'strip-c' );
		$field_id      = (int) $this->create_field(
			$collection_id,
			array(
				'title' => 'Tag',
				'type'  => 'multiselect',
			)
		)->get_data()['id'];

		$this->update_options(
			$field_id,
			array(
				'options' => array(
					array(
						'value' => 'one',
						'label' => 'One',
						'color' => 'sienna',
					),
				),
			)
		);

		$stored = json_decode( get_post_meta( $field_id, 'options', true ), true );

		$this->assertArrayNotHasKey( 'color', $stored[0] );
	}

	public function test_update_options_rejects_non_select_field(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Wrong', 'wrong-t' );
		$field_id      = (int) $this->create_field(
			$collection_id,
			array(
				'title' => 'Notes',
				'type'  => 'text',
			)
		)->get_data()['id'];

		$response = $this->update_options(
			$field_id,
			array(
				'options' => array(
					array(
						'value' => 'a',
						'label' => 'A',
					),
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_update_options_rejects_replace_to_unknown_value(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Replace', 'replace-x' );
		$field_id      = (int) $this->create_field(
			$collection_id,
			array(
				'title'   => 'Status',
				'type'    => 'select',
				'options' => array(
					array(
						'value' => 'a',
						'label' => 'A',
					),
				),
			)
		)->get_data()['id'];

		$response = $this->update_options(
			$field_id,
			array(
				'options'    => array(
					array(
						'value' => 'a',
						'label' => 'A',
					),
				),
				'migrations' => array(
					array(
						'from'   => 'b',
						'action' => 'replace',
						'to'     => 'ghost',
					),
				),
			)
		);

		$this->assertSame( 400, $response->get_status() );
	}

	public function test_update_options_requires_edit_capability(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Auth', 'auth-o' );
		$field_id      = (int) $this->create_field(
			$collection_id,
			array(
				'title' => 'Status',
				'type'  => 'select',
			)
		)->get_data()['id'];

		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->update_options(
			$field_id,
			array(
				'options' => array(
					array(
						'value' => 'a',
						'label' => 'A',
					),
				),
			)
		);

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_option_usage_returns_zero_when_no_rows_match(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Usage', 'usage-z' );
		$field_id      = (int) $this->create_field(
			$collection_id,
			array(
				'title' => 'Status',
				'type'  => 'select',
			)
		)->get_data()['id'];

		$request = new WP_REST_Request(
			'GET',
			"/cortext/v1/fields/{$field_id}/options/lonely/usage"
		);
		$request->set_param( 'field_id', $field_id );
		$request->set_param( 'value', 'lonely' );
		$response = rest_do_request( $request );

		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 0, $response->get_data()['count'] );
	}

	public function test_collect_option_tokens_for_text_to_select_dedupes_and_keeps_first(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'tokens-sel',
			array( 'Open', 'Closed', 'Open', 'In Progress' )
		);

		$tokens = $this->collect_option_tokens( $field_id, 'select', $row_ids );

		sort( $tokens );
		$this->assertSame( array( 'Closed', 'In Progress', 'Open' ), $tokens );
	}

	public function test_collect_option_tokens_for_text_to_multiselect_splits_delimiters(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'tokens-multi',
			array( 'Open, Closed', 'In Progress', 'Open; Pending' )
		);

		$tokens = $this->collect_option_tokens( $field_id, 'multiselect', $row_ids );

		sort( $tokens );
		$this->assertSame( array( 'Closed', 'In Progress', 'Open', 'Pending' ), $tokens );
	}

	public function test_collect_option_tokens_for_text_to_select_keeps_only_first_token(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'tokens-sel-first',
			array( 'Open, Closed, Pending' )
		);

		$tokens = $this->collect_option_tokens( $field_id, 'select', $row_ids );

		$this->assertSame( array( 'Open' ), $tokens );
	}

	public function test_convert_text_to_number_returns_lean_response_without_scanning_rows(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id ] = $this->fixture_text_field_with_rows( 'lean', array( '42', 'abc' ) );

		$response = $this->convert_field( $field_id, 'number' );

		$this->assertSame( 200, $response->get_status() );
		$data = $response->get_data();
		// Non-option conversions do not scan rows, so the response stays small.
		$this->assertSame(
			array( 'id', 'type', 'from', 'new_options' ),
			array_keys( $data )
		);
		$this->assertSame( 'number', $data['type'] );
		$this->assertSame( 'text', $data['from'] );
		$this->assertSame( array(), $data['new_options'] );
		$this->assertSame( 'number', get_post_meta( $field_id, 'type', true ) );
	}

	public function test_convert_rejects_unsupported_pair(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id ] = $this->fixture_text_field_with_rows( 'reject', array( 'a' ) );

		$response = $this->convert_field( $field_id, 'relation' );
		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_field_conversion_unsupported', $response->as_error()->get_error_code() );
		$this->assertSame( 'text', get_post_meta( $field_id, 'type', true ) );
	}

	public function test_convert_rejects_same_type(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id ] = $this->fixture_text_field_with_rows( 'same', array( 'a' ) );

		$response = $this->convert_field( $field_id, 'text' );
		$this->assertSame( 400, $response->get_status() );
	}

	public function test_convert_date_to_text_stashes_prior_format(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Dates', 'datestash' );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Due',
				'meta_input'  => array(
					'type'        => 'date',
					'date_format' => 'F j, Y',
				),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$response = $this->convert_field( $field_id, 'text' );
		$this->assertSame( 200, $response->get_status() );
		$this->assertSame( 'F j, Y', get_post_meta( $field_id, 'prior_date_format', true ) );
		$this->assertSame( 'text', get_post_meta( $field_id, 'type', true ) );
	}

	public function test_convert_text_to_select_makes_format_typed_value_return_chip(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'select-render',
			array( 'Open', 'Closed', 'Open' )
		);

		// Mirror the commit path inline so the test can inspect the row output
		// without depending on WorDBless row queries.
		$tokens    = $this->collect_option_tokens( $field_id, 'select', $row_ids );
		$additions = array();
		foreach ( $tokens as $value ) {
			$additions[] = array(
				'value' => $value,
				'label' => $value,
			);
		}
		$this->assertSame( array( 'Open', 'Closed' ), $tokens );
		update_post_meta( $field_id, 'options', wp_json_encode( $additions ) );
		update_post_meta( $field_id, 'type', 'select' );

		$rendered = array();
		foreach ( $row_ids as $row_id ) {
			$rendered[] = $this->invoke_format_typed_value( $row_id, $field_id, 'select', false );
		}

		$this->assertSame( array( 'Open', 'Closed', 'Open' ), $rendered );
	}

	public function test_convert_text_to_select_renders_first_token_for_delimited_values(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'select-split',
			array(
				'Open, Closed, Pending',
				'In Progress',
				'Done; Archived',
			)
		);

		$tokens = $this->collect_option_tokens( $field_id, 'select', $row_ids );
		// Select keeps only the first token from each row.
		sort( $tokens );
		$this->assertSame( array( 'Done', 'In Progress', 'Open' ), $tokens );

		$additions = array();
		foreach ( $tokens as $value ) {
			$additions[] = array(
				'value' => $value,
				'label' => $value,
			);
		}
		update_post_meta( $field_id, 'options', wp_json_encode( $additions ) );
		update_post_meta( $field_id, 'type', 'select' );

		$rendered = array();
		foreach ( $row_ids as $row_id ) {
			$rendered[] = $this->invoke_format_typed_value( $row_id, $field_id, 'select', false );
		}

		$this->assertSame( array( 'Open', 'In Progress', 'Done' ), $rendered );
	}

	private function invoke_format_typed_value(
		int $row_id,
		int $field_id,
		string $field_type,
		bool $is_multi
	) {
		$controller = new \Cortext\Rest\RowsController();
		$method     = new \ReflectionMethod( $controller, 'format_typed_value' );
		$method->setAccessible( true );
		return $method->invoke( $controller, $row_id, $field_id, $field_type, $is_multi );
	}

	public function test_format_typed_value_preserves_select_option_with_delimiters(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Vendors', 'vendors-sel' );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Vendor',
				'meta_input'  => array(
					'type'    => 'select',
					'options' => wp_json_encode(
						array(
							array(
								'value' => 'ACME, Inc.',
								'label' => 'ACME, Inc.',
							),
						)
					),
				),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => 'crtxt_vendors-sel',
				'post_status' => 'publish',
				'post_title'  => 'Row',
			)
		);
		update_post_meta( $row_id, "field-{$field_id}", 'ACME, Inc.' );

		$this->assertSame(
			'ACME, Inc.',
			$this->invoke_format_typed_value( $row_id, $field_id, 'select', false )
		);
	}

	public function test_format_typed_value_preserves_multiselect_option_with_delimiters(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Tags', 'tags-multi' );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Vendors',
				'meta_input'  => array(
					'type'    => 'multiselect',
					'options' => wp_json_encode(
						array(
							array(
								'value' => 'ACME, Inc.',
								'label' => 'ACME, Inc.',
							),
						)
					),
				),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => 'crtxt_tags-multi',
				'post_status' => 'publish',
				'post_title'  => 'Row',
			)
		);
		add_post_meta( $row_id, "field-{$field_id}", 'ACME, Inc.' );

		$this->assertSame(
			array( 'ACME, Inc.' ),
			$this->invoke_format_typed_value( $row_id, $field_id, 'multiselect', true )
		);
	}

	public function test_write_field_value_replaces_multiselect_residue(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Edits', 'edits-collapse' );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Format',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => 'crtxt_edits-collapse',
				'post_status' => 'publish',
				'post_title'  => 'Row',
			)
		);
		// Simulate leftover multiselect storage: two meta rows under one key.
		add_post_meta( $row_id, "field-{$field_id}", 'CD' );
		add_post_meta( $row_id, "field-{$field_id}", 'Record' );

		$controller = new \Cortext\Rest\RowsController();
		$method     = new \ReflectionMethod( $controller, 'write_field_value' );
		$method->setAccessible( true );
		$method->invoke( $controller, $row_id, $field_id, 'text', 'vinyl' );

		$this->assertSame(
			array( 'vinyl' ),
			get_post_meta( $row_id, "field-{$field_id}", false ),
			'Single-value writes should replace leftover multiselect rows.'
		);
	}

	public function test_format_typed_value_joins_multiselect_residue_for_text(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		$collection_id = $this->create_collection_with_slug( 'Formats', 'formats-join' );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Formats',
				// Back to `text`, but the row still has multiple chip values.
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$row_id = (int) wp_insert_post(
			array(
				'post_type'   => 'crtxt_formats-join',
				'post_status' => 'publish',
				'post_title'  => 'Row',
			)
		);
		add_post_meta( $row_id, "field-{$field_id}", 'CD' );
		add_post_meta( $row_id, "field-{$field_id}", 'Record' );

		$this->assertSame(
			'CD, Record',
			$this->invoke_format_typed_value( $row_id, $field_id, 'text', false )
		);
	}

	public function test_format_typed_value_hides_invalid_email(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'email-invalid',
			array( 'user@example.com', 'not-an-email', '' )
		);
		update_post_meta( $field_id, 'type', 'email' );

		$rendered = array();
		foreach ( $row_ids as $row_id ) {
			$rendered[] = $this->invoke_format_typed_value( $row_id, $field_id, 'email', false );
		}
		$this->assertSame( array( 'user@example.com', '', '' ), $rendered );
	}

	public function test_format_typed_value_hides_invalid_url(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'url-invalid',
			array( 'https://example.com', 'abc', '' )
		);
		update_post_meta( $field_id, 'type', 'url' );

		$rendered = array();
		foreach ( $row_ids as $row_id ) {
			$rendered[] = $this->invoke_format_typed_value( $row_id, $field_id, 'url', false );
		}
		$this->assertSame( array( 'https://example.com', '', '' ), $rendered );
	}

	public function test_convert_round_trip_preserves_stored_text(): void {
		wp_set_current_user( $this->create_user( 'editor' ) );
		[ , $field_id, $row_ids ] = $this->fixture_text_field_with_rows(
			'round-trip',
			array( '42', 'abc' )
		);

		// Non-option conversion: only the field type changes.
		update_post_meta( $field_id, 'type', 'number' );

		// Change back to text; row meta is still the original.
		update_post_meta( $field_id, 'type', 'text' );

		$values = array();
		foreach ( $row_ids as $row_id ) {
			$values[] = (string) get_post_meta( $row_id, "field-{$field_id}", true );
		}
		sort( $values );
		$this->assertSame( array( '42', 'abc' ), $values );
	}

	private function collect_option_tokens( int $field_id, string $target_type, array $row_ids ): array {
		$controller = new FieldsController();
		$method     = new \ReflectionMethod( $controller, 'collect_option_tokens' );
		$method->setAccessible( true );
		return $method->invoke( $controller, $field_id, $target_type, $row_ids );
	}

	private function convert_field( int $field_id, string $target_type ) {
		$request = new WP_REST_Request( 'POST', "/cortext/v1/fields/{$field_id}/convert" );
		$request->set_param( 'field_id', $field_id );
		$request->set_param( 'type', $target_type );
		return rest_do_request( $request );
	}

	/**
	 * @return array{0:int,1:int,2:int[]} Collection id, field id, row ids.
	 */
	private function fixture_text_field_with_rows( string $slug, array $values ): array {
		$collection_id = $this->create_collection_with_slug( ucfirst( $slug ), $slug );

		$field_id = (int) wp_insert_post(
			array(
				'post_type'   => Field::POST_TYPE,
				'post_status' => 'private',
				'post_title'  => 'Status',
				'meta_input'  => array( 'type' => 'text' ),
			)
		);
		add_post_meta( $collection_id, 'fields', (string) $field_id );
		( new CollectionEntries() )->register_for_collection( get_post( $collection_id ) );

		$row_post_type = 'crtxt_' . $slug;
		$row_ids       = array();
		foreach ( $values as $idx => $value ) {
			$row_id = (int) wp_insert_post(
				array(
					'post_type'   => $row_post_type,
					'post_status' => 'publish',
					'post_title'  => "Row {$idx}",
				)
			);
			update_post_meta( $row_id, "field-{$field_id}", $value );
			$row_ids[] = $row_id;
		}

		return array( $collection_id, $field_id, $row_ids );
	}

	private function update_options( int $field_id, array $body ) {
		$request = new WP_REST_Request(
			'POST',
			"/cortext/v1/fields/{$field_id}/options"
		);
		$request->set_param( 'field_id', $field_id );
		foreach ( $body as $key => $value ) {
			$request->set_param( $key, $value );
		}
		return rest_do_request( $request );
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
