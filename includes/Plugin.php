<?php
/**
 * Plugin bootstrap.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\Admin\Screen;
use Cortext\Editor\RevisionThrottle;
use Cortext\Frontend\Assets;
use Cortext\Frontend\Template;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use Cortext\Rest\CollectionsController;
use Cortext\Rest\PageTrashController;
use Cortext\Rest\RowsController;

final class Plugin {

	private static ?Plugin $instance = null;

	public static function instance(): self {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	public function boot(): void {
		( new Screen() )->register();
		( new Page() )->register();
		( new PageTrashCascade() )->register();
		( new Collection() )->register();
		( new Field() )->register();
		( new CollectionEntries() )->register();
		( new RevisionThrottle() )->register();
		( new CollectionsController() )->register();
		( new PageTrashController() )->register();
		( new RowsController() )->register();
		( new Template() )->register();
		( new Assets() )->register();
	}

	private function __construct() {}
}
