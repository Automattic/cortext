<?php
/**
 * Plugin bootstrap.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\Admin\MenuLink;
use Cortext\Shell\Shell;

final class Plugin {

	private static ?Plugin $instance = null;

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function boot(): void {
		( new Shell() )->register();
		( new MenuLink() )->register();
	}

	private function __construct() {}
}
