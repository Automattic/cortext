<?php
/**
 * PHP files to compile during the Desktop OPcache preload exploration.
 *
 * Avoid bootstrap files such as wp-config.php, wp-load.php, and
 * wp-settings.php. This list should compile definitions without running
 * WordPress startup side effects.
 *
 * @package Cortext
 */

return array(
	'wp-content/plugins/cortext/includes/Plugin.php',
	'wp-content/plugins/cortext/includes/Documents.php',
	'wp-content/plugins/cortext/includes/Relations.php',
	'wp-content/plugins/cortext/includes/Block/DataView.php',
	'wp-content/plugins/cortext/includes/Rest/CollectionsController.php',
	'wp-content/plugins/cortext/includes/Rest/DocumentsController.php',
	'wp-content/plugins/cortext/includes/Rest/FieldsController.php',
	'wp-content/plugins/cortext/includes/Rest/RowsController.php',
	'wp-content/plugins/cortext/includes/Rest/RowsFilterQuery.php',
	'wp-content/plugins/cortext/includes/Rest/RowsMetaQuery.php',
	'wp-content/plugins/cortext/includes/Rest/RowsQueryScope.php',
	'wp-content/plugins/cortext/includes/Rest/WorkspaceHomeController.php',
	'wp-content/plugins/cortext/includes/PostType/Collection.php',
	'wp-content/plugins/cortext/includes/PostType/CollectionEntries.php',
	'wp-content/plugins/cortext/includes/PostType/DocumentIdentity.php',
	'wp-content/plugins/cortext/includes/PostType/Field.php',
	'wp-content/plugins/cortext/includes/PostType/Page.php',
);
