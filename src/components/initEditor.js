// Registers the core and Cortext blocks for every editor surface in the
// shell. Canvas (full document editor) and RowEditor (row peek, modal,
// and full-page row editor) both mount EditorProvider, so each one
// imports this module to make sure registration runs before any editor
// renders blocks. The guard makes the side effect idempotent: whichever
// surface loads first wins, the second is a no-op.
//
// `ALLOWED_BLOCK_TYPES` is the editor's block list. `getEditorSettings()`
// passes it to Gutenberg as `allowedBlockTypes`, which the editor checks for
// the inserter, slash search, paste, and programmatic inserts. Blocks outside
// the list stay registered, so stored content and `createBlock` keep working;
// they just do not appear in the UI.
import { registerCoreBlocks } from '@wordpress/block-library';
import { addFilter } from '@wordpress/hooks';

// Register the `cortext` category before the `../blocks` barrel registers
// Cortext blocks from block.json.
import { CORTEXT_BLOCK_CATEGORY } from './cortextBlockCategory';
import '../blocks';

// `core/post-title` is insertable by default. Cortext owns title placement
// through EnsureHeaderBlocks, so users should not see the block in the
// inserter. Flip the support before `registerCoreBlocks` reads it.
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
			},
		};
	}
);

export { CORTEXT_BLOCK_CATEGORY };

// Blocks allowed in a Cortext document. Most are user-insertable; a few are
// inserted by Cortext itself. Blocks outside this list, including late
// third-party registrations, stay out of the inserter, slash search, and paste.
// A few entries need extra context:
//
// - `core/post-title` and the `cortext/document-*` blocks are inserted
//   by Cortext's header lifecycle. If these are missing, `insertBlocks` rejects
//   the header.
// - The post-context blocks (`core/post-date`, `core/post-time-to-read`)
//   read `postId` and `postType` from `usesContext`. EditorProvider supplies
//   both for each Cortext document, so these work directly in documents. Leave
//   out post-author and post-excerpt because they also need post-type
//   `supports` flags that Cortext does not declare.
export const ALLOWED_BLOCK_TYPES = [
	// Text & structure
	'core/paragraph',
	'core/heading',
	'core/list',
	'core/list-item',
	'core/quote',
	'core/pullquote',
	'core/verse',
	'core/code',
	'core/preformatted',
	'core/html',
	'core/math',
	'core/footnotes',
	'core/details',
	'core/post-title',

	// Media
	'core/image',
	'core/gallery',
	'core/video',
	'core/audio',
	'core/file',
	'core/cover',
	'core/media-text',

	// Layout
	'core/columns',
	'core/column',
	'core/group',
	'core/separator',
	'core/spacer',

	// Interactive
	'core/button',
	'core/buttons',
	'core/accordion',
	'core/accordion-item',
	'core/accordion-heading',
	'core/accordion-panel',
	'core/social-link',
	'core/social-links',

	// Utility
	'core/table',
	'core/embed',
	'core/table-of-contents',
	'core/icon',

	// Document metadata (read the current postId/postType from context)
	'core/post-date',
	'core/post-time-to-read',

	// Reusable
	'core/pattern',
	'core/block',

	// Cortext-native
	'cortext/data-view',
	'cortext/document-icon',
	'cortext/document-cover',
	'cortext/document-properties',
];

export function getEditorSettings() {
	return {
		...( window.cortextEditorSettings ?? {} ),
		allowedBlockTypes: ALLOWED_BLOCK_TYPES,
	};
}

if ( ! window.__cortextBlocksRegistered ) {
	registerCoreBlocks();
	window.__cortextBlocksRegistered = true;
}
