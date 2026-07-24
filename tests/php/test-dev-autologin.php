<?php
/**
 * Tests for the local development autologin plugin.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext\Tests;

use WorDBless\BaseTestCase;

require_once dirname( __DIR__, 2 ) . '/scripts/dev-autologin.php';

final class Test_Dev_Autologin extends BaseTestCase {

	public function test_accepts_loopback_hosts_with_optional_ports(): void {
		$hosts = array(
			'localhost',
			'localhost:55270',
			'127.0.0.1',
			'127.0.0.1:8080',
			'[::1]',
			'[::1]:8888',
			'localhost:65535',
		);

		foreach ( $hosts as $host ) {
			$this->assertTrue(
				\cortext_dev_autologin_is_loopback_host( $host ),
				"Expected {$host} to be accepted."
			);
		}
	}

	public function test_rejects_non_loopback_and_malformed_hosts(): void {
		$hosts = array(
			'',
			'example.com',
			'192.168.1.10',
			'0.0.0.0',
			'localhost.example.com',
			'localhost:',
			'localhost/path',
			'localhost%00',
			'localhost%20',
			'localhost:0',
			'localhost:65536',
			'localhost:999999999999999999999999',
			'local\\host',
			'localhost\\',
			'::1',
			'[::1].example.com',
		);

		foreach ( $hosts as $host ) {
			$this->assertFalse(
				\cortext_dev_autologin_is_loopback_host( $host ),
				"Expected {$host} to be rejected."
			);
		}
	}

	public function test_preserves_the_raw_host_for_exact_validation(): void {
		$had_host              = array_key_exists( 'HTTP_HOST', $_SERVER );
		$previous_host         = $_SERVER['HTTP_HOST'] ?? null;
		$had_forwarded_host    = array_key_exists(
			'HTTP_X_CORTEXT_FORWARDED_HOST',
			$_SERVER
		);
		$previous_forwarded_host =
			$_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] ?? null;

		try {
			unset( $_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] );
			$_SERVER['HTTP_HOST'] = 'local\\host';
			$host                 = \cortext_dev_autologin_request_host();

			$this->assertSame( 'local\\host', $host );
			$this->assertFalse(
				\cortext_dev_autologin_is_loopback_host( $host )
			);
		} finally {
			if ( $had_host ) {
				$_SERVER['HTTP_HOST'] = $previous_host;
			} else {
				unset( $_SERVER['HTTP_HOST'] );
			}
			if ( $had_forwarded_host ) {
				$_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] =
					$previous_forwarded_host;
			} else {
				unset( $_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] );
			}
		}
	}

	public function test_uses_the_raw_public_host_forwarded_by_the_proxy(): void {
		$had_host              = array_key_exists( 'HTTP_HOST', $_SERVER );
		$previous_host         = $_SERVER['HTTP_HOST'] ?? null;
		$had_forwarded_host    = array_key_exists(
			'HTTP_X_CORTEXT_FORWARDED_HOST',
			$_SERVER
		);
		$previous_forwarded_host =
			$_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] ?? null;

		try {
			$_SERVER['HTTP_HOST'] = 'localhost:55271';
			$_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] = 'localhost:55270';

			$this->assertSame(
				'localhost:55270',
				\cortext_dev_autologin_request_host()
			);

			$_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] = 'localhost\\';
			$host = \cortext_dev_autologin_request_host();

			$this->assertSame( 'localhost\\', $host );
			$this->assertFalse(
				\cortext_dev_autologin_is_loopback_host( $host )
			);
		} finally {
			if ( $had_host ) {
				$_SERVER['HTTP_HOST'] = $previous_host;
			} else {
				unset( $_SERVER['HTTP_HOST'] );
			}
			if ( $had_forwarded_host ) {
				$_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] =
					$previous_forwarded_host;
			} else {
				unset( $_SERVER['HTTP_X_CORTEXT_FORWARDED_HOST'] );
			}
		}
	}

	public function test_sets_the_local_framing_policy_only_for_loopback_hosts(): void {
		$this->assertSame(
			"frame-ancestors 'self' http://localhost:*;",
			\cortext_dev_autologin_content_security_policy( 'localhost:55270' )
		);
		$this->assertSame(
			"frame-ancestors 'self' http://localhost:*;",
			\cortext_dev_autologin_content_security_policy( '127.0.0.1' )
		);
		$this->assertSame(
			"frame-ancestors 'self' http://localhost:*;",
			\cortext_dev_autologin_content_security_policy( '[::1]:8080' )
		);
		$this->assertNull(
			\cortext_dev_autologin_content_security_policy( 'example.com' )
		);
	}

	public function test_requires_the_private_proxy_token(): void {
		$this->assertTrue(
			\cortext_dev_autologin_matches_proxy_token(
				'expected-token',
				'expected-token'
			)
		);
		$this->assertFalse(
			\cortext_dev_autologin_matches_proxy_token(
				'spoofed-token',
				'expected-token'
			)
		);
		$this->assertFalse(
			\cortext_dev_autologin_matches_proxy_token( '', '' )
		);
	}

	public function test_handles_only_local_admin_and_login_requests(): void {
		$this->assertTrue(
			\cortext_dev_autologin_should_handle_request(
				'localhost:55270',
				'/wp-admin/admin.php?page=cortext',
				'',
				true
			)
		);
		$this->assertTrue(
			\cortext_dev_autologin_should_handle_request(
				'127.0.0.1:8080',
				'/wp-login.php?redirect_to=%2Fwp-admin%2F',
				'',
				true
			)
		);
		$this->assertFalse(
			\cortext_dev_autologin_should_handle_request(
				'localhost:55270',
				'/',
				'',
				true
			)
		);
		$this->assertFalse(
			\cortext_dev_autologin_should_handle_request(
				'example.com',
				'/wp-admin/admin.php?page=cortext',
				'',
				true
			)
		);
		$this->assertFalse(
			\cortext_dev_autologin_should_handle_request(
				'localhost:55270',
				'/wp-admin/admin.php?page=cortext',
				'',
				false
			)
		);
	}

	public function test_e2e_marker_bypasses_autologin_only_for_the_marked_request(): void {
		$this->assertFalse(
			\cortext_dev_autologin_should_handle_request(
				'localhost:55270',
				'/wp-admin/admin.php?page=cortext',
				'1',
				true
			)
		);
		$this->assertTrue(
			\cortext_dev_autologin_should_handle_request(
				'localhost:55270',
				'/wp-admin/admin.php?page=cortext',
				'',
				true
			)
		);
		$this->assertTrue(
			\cortext_dev_autologin_should_handle_request(
				'localhost:55270',
				'/wp-admin/admin.php?page=cortext',
				'true',
				true
			)
		);
	}

	public function test_exposes_new_auth_cookies_to_the_current_request(): void {
		$cookie_names = array(
			AUTH_COOKIE,
			SECURE_AUTH_COOKIE,
			LOGGED_IN_COOKIE,
		);
		$previous     = array();

		foreach ( $cookie_names as $cookie_name ) {
			$previous[ $cookie_name ] = array(
				'exists' => array_key_exists( $cookie_name, $_COOKIE ),
				'value'  => $_COOKIE[ $cookie_name ] ?? null,
			);
			unset( $_COOKIE[ $cookie_name ] );
		}

		try {
			\cortext_dev_autologin_set_request_auth_cookie(
				'auth-value',
				0,
				0,
				1,
				'auth'
			);
			\cortext_dev_autologin_set_request_auth_cookie(
				'secure-value',
				0,
				0,
				1,
				'secure_auth'
			);
			\cortext_dev_autologin_set_request_logged_in_cookie( 'logged-in-value' );

			$this->assertSame( 'auth-value', $_COOKIE[ AUTH_COOKIE ] );
			$this->assertSame( 'secure-value', $_COOKIE[ SECURE_AUTH_COOKIE ] );
			$this->assertSame( 'logged-in-value', $_COOKIE[ LOGGED_IN_COOKIE ] );
		} finally {
			foreach ( $previous as $cookie_name => $state ) {
				if ( $state['exists'] ) {
					$_COOKIE[ $cookie_name ] = $state['value'];
				} else {
					unset( $_COOKIE[ $cookie_name ] );
				}
			}
		}
	}

	public function test_registers_framing_callbacks_before_wordpress_core(): void {
		$this->assertSame(
			0,
			has_action( 'admin_init', 'cortext_dev_autologin_allow_local_framing' )
		);
		$this->assertSame(
			0,
			has_action( 'login_init', 'cortext_dev_autologin_allow_local_framing' )
		);
	}

	public function test_removes_core_frame_options_hooks_for_loopback_hosts(): void {
		add_action( 'admin_init', 'send_frame_options_header', 10 );
		add_action( 'login_init', 'send_frame_options_header', 10 );

		$this->assertTrue(
			\cortext_dev_autologin_remove_frame_options_hooks( 'localhost:55270' )
		);
		$this->assertFalse( has_action( 'admin_init', 'send_frame_options_header' ) );
		$this->assertFalse( has_action( 'login_init', 'send_frame_options_header' ) );
	}

	public function test_leaves_core_frame_options_hooks_untouched_for_non_loopback_hosts(): void {
		add_action( 'admin_init', 'send_frame_options_header', 10 );
		add_action( 'login_init', 'send_frame_options_header', 10 );

		$this->assertFalse(
			\cortext_dev_autologin_remove_frame_options_hooks( 'example.com' )
		);
		$this->assertSame( 10, has_action( 'admin_init', 'send_frame_options_header' ) );
		$this->assertSame( 10, has_action( 'login_init', 'send_frame_options_header' ) );
	}
}
