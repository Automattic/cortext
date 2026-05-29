<?php
/**
 * Plugin bootstrap.
 *
 * @package Cortext
 */

declare( strict_types=1 );

namespace Cortext;

use Cortext\Admin\Screen;
use Cortext\Block\DataView;
use Cortext\Editor\DocumentCoverBlock;
use Cortext\Editor\DocumentIconBlock;
use Cortext\Editor\DocumentPropertiesBlock;
use Cortext\Editor\RevisionThrottle;
use Cortext\FieldValues\FieldValueIndex;
use Cortext\Frontend\Assets;
use Cortext\Frontend\Template;
use Cortext\PostType\Cascade\CollectionToRowTrashCascade;
use Cortext\PostType\Cascade\DocumentToCollectionTrashCascade;
use Cortext\PostType\Cascade\PageHierarchyTrashCascade;
use Cortext\PostType\Collection;
use Cortext\PostType\CollectionContentBackfill;
use Cortext\PostType\CollectionEntries;
use Cortext\PostType\DocumentIdentity;
use Cortext\PostType\Field;
use Cortext\PostType\Page;
use Cortext\PostType\TrashCascadeEngine;
use Cortext\Rest\DocumentLocatorController;
use Cortext\Rest\DocumentsController;
use Cortext\Rest\FavoritesController;
use Cortext\Rest\FieldsController;
use Cortext\Notion\Importer as NotionImporter;
use Cortext\Rest\NotionController;
use Cortext\Rest\RecentsController;
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
		( new Collection() )->register();
		( new CollectionContentBackfill() )->register();
		( new Field() )->register();
		( new CollectionEntries() )->register();
		( new FieldValueIndex() )->register();

		// Single cascade engine: the same instance registers the WordPress
		// hooks and answers `descendants_for_root` for the REST endpoints.
		// Adding a new strategy in one place wires it everywhere.
		$cascade_engine = new TrashCascadeEngine(
			array(
				new PageHierarchyTrashCascade(),
				new DocumentToCollectionTrashCascade(),
				new CollectionToRowTrashCascade( new CollectionEntries() ),
			)
		);
		$cascade_engine->register();

		( new RevisionThrottle() )->register();
		( new DocumentIconBlock() )->register();
		( new DocumentCoverBlock() )->register();
		( new DocumentPropertiesBlock() )->register();
		( new FavoritesController() )->register();
		( new FieldsController() )->register();
		( new DocumentLocatorController() )->register();
		( new DocumentsController( null, $cascade_engine ) )->register();
		( new RecentsController() )->register();
		( new RowsController() )->register();
		( new WorkspaceHomeController() )->register();
		( new NotionController() )->register();
		( new NotionImporter() )->register();
		( new Template() )->register();
		( new Assets() )->register();
		( new DataView() )->register();
		( new Preferences() )->register();
	}

	private function __construct() {}
}
