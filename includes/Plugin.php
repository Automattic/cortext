<?php
/**
 * Plugin bootstrap.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\Admin\Screen;
use Cortext\Editor\PageCoverBlock;
use Cortext\Editor\PageHeaderActionsBlock;
use Cortext\Editor\PageIconBlock;
use Cortext\Editor\RevisionThrottle;
use Cortext\Frontend\Assets;
use Cortext\Frontend\Template;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\Field;
use Cortext\PostType\Page;
use Cortext\PostType\PageIdentity;
use Cortext\PostType\PageTrashCascade;
use Cortext\Rest\CollectionsController;
use Cortext\Rest\FieldsController;
use Cortext\Rest\PageTrashController;
use Cortext\Rest\RowsController;
use Cortext\Theming\Preferences;

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
		( new PageIdentity() )->register();
		( new PageTrashCascade() )->register();
		( new Collection() )->register();
		( new Field() )->register();
		( new CollectionEntries() )->register();
		( new RevisionThrottle() )->register();
		( new PageIconBlock() )->register();
		( new PageCoverBlock() )->register();
		( new PageHeaderActionsBlock() )->register();
		( new CollectionsController() )->register();
		( new FieldsController() )->register();
		( new PageTrashController() )->register();
		( new RowsController() )->register();
		( new Template() )->register();
		( new Assets() )->register();
		( new Preferences() )->register();
	}

	private function __construct() {}
}
