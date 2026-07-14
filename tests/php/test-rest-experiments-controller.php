<?php
/**
 * Tests for Cortext\Rest\ExperimentsController.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use Cortext\Rest\ExperimentsController;
use Cortext\Runtime\Experiments;
use WorDBless\BaseTestCase;
use WP_REST_Request;
use WP_REST_Server;

final class Test_Rest_Experiments_Controller extends BaseTestCase {

	public function set_up(): void {
		parent::set_up();

		$GLOBALS['wp_rest_server'] = new WP_REST_Server();
		( new ExperimentsController() )->register();
		do_action( 'rest_api_init' );
	}

	public function tear_down(): void {
		remove_all_filters( 'cortext_experiments' );
		delete_option( Experiments::OPTION );
		wp_set_current_user( 0 );
		parent::tear_down();
	}

	public function test_route_is_registered(): void {
		$routes = rest_get_server()->get_routes();

		$this->assertArrayHasKey( '/cortext/v1/experiments', $routes );
	}

	public function test_get_requires_edit_posts(): void {
		wp_set_current_user( $this->create_user( 'subscriber' ) );

		$response = $this->get_experiments();

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_get_returns_experiments_and_manage_capability(): void {
		$this->register_sample_experiment();
		wp_set_current_user( $this->create_user( 'editor' ) );

		$response = $this->get_experiments();

		$this->assertSame( 200, $response->get_status() );
		$this->assertFalse( $response->get_data()['canManage'] );
		$this->assertSame(
			array(
				array(
					'id'          => 'fastMode',
					'label'       => 'Fast mode',
					'description' => 'Makes things faster.',
					'group'       => 'Labs',
					'enabled'     => false,
				),
			),
			$response->get_data()['experiments']
		);
	}

	public function test_put_requires_manage_options(): void {
		$this->register_sample_experiment();
		wp_set_current_user( $this->create_user( 'editor' ) );

		$response = $this->set_experiments( array( 'fastMode' => true ) );

		$this->assertSame( 403, $response->get_status() );
	}

	public function test_put_rejects_unknown_ids(): void {
		$this->register_sample_experiment();
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->set_experiments( array( 'missing' => true ) );

		$this->assertSame( 400, $response->get_status() );
		$this->assertSame( 'cortext_experiments_unknown_id', $response->get_data()['code'] );
	}

	public function test_put_updates_known_experiments(): void {
		$this->register_sample_experiment();
		wp_set_current_user( $this->create_user( 'administrator' ) );

		$response = $this->set_experiments( array( 'fastMode' => true ) );

		$this->assertSame( 200, $response->get_status() );
		$this->assertTrue( $response->get_data()['canManage'] );
		$this->assertTrue( $response->get_data()['experiments'][0]['enabled'] );
		$this->assertSame(
			array( 'fastMode' => true ),
			get_option( Experiments::OPTION, array() )
		);
	}

	private function get_experiments() {
		return rest_do_request( new WP_REST_Request( 'GET', '/cortext/v1/experiments' ) );
	}

	/**
	 * Updates experiment settings through REST.
	 *
	 * @param array<string,bool> $enabled Experiment IDs mapped to enabled values.
	 */
	private function set_experiments( array $enabled ) {
		$request = new WP_REST_Request( 'PUT', '/cortext/v1/experiments' );
		$request->set_body_params(
			array(
				'enabled' => $enabled,
			)
		);
		return rest_do_request( $request );
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

	private function register_sample_experiment(): void {
		add_filter(
			'cortext_experiments',
			static fn () => array(
				array(
					'id'          => 'fastMode',
					'label'       => 'Fast mode',
					'description' => 'Makes things faster.',
					'group'       => 'Labs',
				),
			)
		);
	}
}
