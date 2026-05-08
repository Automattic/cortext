<?php
/**
 * Plugin bootstrap.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\Admin\Screen;
use Cortext\Editor\DocumentCoverBlock;
use Cortext\Editor\DocumentIconBlock;
use Cortext\Editor\PageHeaderActionsBlock;
use Cortext\Editor\RevisionThrottle;
use Cortext\Frontend\Assets;
use Cortext\Frontend\Template;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\Page;
use Cortext\PostType\PageTrashCascade;
use Cortext\Rest\CollectionsController;
use Cortext\Rest\DocumentTrashController;
use Cortext\Rest\FieldsController;
use Cortext\Rest\RowsController;
use Cortext\Rest\WorkspaceHomeController;
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
		( new DocumentIdentity() )->register();
		( new PageTrashCascade() )->register();
		( new Collection() )->register();
		( new Field() )->register();
		( new CollectionEntries() )->register();
		( new RevisionThrottle() )->register();
		( new DocumentIconBlock() )->register();
		( new DocumentCoverBlock() )->register();
		( new PageHeaderActionsBlock() )->register();
		( new CollectionsController() )->register();
		( new FieldsController() )->register();
		( new DocumentTrashController() )->register();
		( new RowsController() )->register();
		( new WorkspaceHomeController() )->register();
		( new Template() )->register();
		( new Assets() )->register();
		( new Preferences() )->register();
	}

	private function __construct() {}
}
