// Registers every block type a Cortext document can contain. The shell entry
// imports this before it renders, because WP 7.1's core-data parses `content`
// when a full document record arrives and caches the result. Parsed with no
// block types registered, the cache holds an empty block list, the editor
// opens blank, and the next autosave erases the page. Sidebar lists such as
// Recents fetch full records before the lazy editor chunk loads. Upstream fix:
// WordPress/gutenberg#81809 (not in WP 7.1).
//
// Only the block types live here. Their edit components and styles load with
// the editor chunk (see `src/blocks/deferredEdit.js`).
import { registerCoreBlocks } from '@wordpress/block-library';
import { addFilter } from '@wordpress/hooks';

// Register the Collections category before the `../blocks` barrel registers
// Cortext blocks from block.json.
import './collectionsBlockCategory';
import '../blocks';

// Core exposes `core/post-title` in the inserter and block actions by default.
// Cortext owns title placement through EnsureHeaderBlocks, so users shouldn't
// insert another title, duplicate it, or unlock its fixed position. Adjust the
// supports before `registerCoreBlocks` reads them.
// Keep it in `ALLOWED_BLOCK_TYPES`: `insertBlocks` checks that list before it
// inserts the locked header. The `cortext/document-*` blocks use the same
// hidden-from-inserter pattern in block.json.
addFilter(
	'blocks.registerBlockType',
	'cortext/hide-post-title-from-inserter',
	( settings, name ) => {
		if ( name !== 'core/post-title' ) {
			return settings;
		}
		return {
			...settings,
			supports: {
				...settings.supports,
				inserter: false,
				lock: false,
				multiple: false,
			},
		};
	}
);

if ( ! window.__cortextBlocksRegistered ) {
	registerCoreBlocks();
	window.__cortextBlocksRegistered = true;
}
