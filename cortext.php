<?php
/**
 * Plugin Name:       Cortext
 * Plugin URI:        https://github.com/priethor/cortext
 * Description:       Notion-inspired workspace inside WordPress: nested pages, typed collections with multiple views, and cross-type taxonomies that add fields to individual rows.
 * Version:           0.0.1
 * Requires at least: 6.9
 * Requires PHP:      8.1
 * Author:            Héctor Prieto, Miguel Fonseca
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       cortext
 *
 * @package Cortext
 */

defined( 'ABSPATH' ) || exit;

define( 'CORTEXT_VERSION', '0.0.1' );
define( 'CORTEXT_PATH', plugin_dir_path( __FILE__ ) );
define( 'CORTEXT_URL', plugin_dir_url( __FILE__ ) );

$cortext_autoload = CORTEXT_PATH . 'vendor/autoload.php';
if ( ! file_exists( $cortext_autoload ) ) {
	add_action(
		'admin_notices',
		static function () {
			echo '<div class="notice notice-error"><p>';
			echo esc_html__( 'Cortext: Composer dependencies are missing. Run "composer install" in the plugin directory.', 'cortext' );
			echo '</p></div>';
		}
	);
	return;
}
require $cortext_autoload;

add_action(
	'plugins_loaded',
	static function () {
		\Cortext\Plugin::instance()->boot();
	}
);

register_activation_hook(
	__FILE__,
	static function () {
		( new \Cortext\PostType\Page() )->register_post_type();
		flush_rewrite_rules();
	}
);

if ( defined( 'WP_CLI' ) && WP_CLI ) {
	\WP_CLI::add_command( 'cortext seed', \Cortext\CLI\SeedDummyCollections::class );
}
