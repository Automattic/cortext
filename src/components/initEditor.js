// Editor setup shared by every editor surface: Canvas, RowEditor, and the
// command palette preview import this module before they render blocks. The
// block types themselves register earlier, from the shell entry (see
// `./registerBlocks`); this module adds their edit components and the
// editor-only extensions.
//
// `ALLOWED_BLOCK_TYPES` is the editor's block list. `getEditorSettings()`
// passes it to Gutenberg as `allowedBlockTypes`, which the editor checks for
// the inserter, slash search, paste, and programmatic inserts. Blocks outside
// the list stay registered, so stored content and `createBlock` keep working;
// they just do not appear in the UI.
import { __, setLocaleData } from '@wordpress/i18n';

import './registerBlocks';
import { COLLECTIONS_BLOCK_CATEGORY } from './collectionsBlockCategory';
import '../blocks/edits';

// Side-effect import: register media categories for the full inserter.
import './initInserterMediaCategories';

// Side-effect import: float Cortext blocks to the top of the slash inserter.
import './prioritizeCortextInserterBlocks';

// Register Cortext's inline mention format and @ completer.
import './mention';

// Register the `cortext/property` block bindings source.
import '../blocks/property-bindings';

// Our link picker's "Create" action makes a Cortext document, not a WordPress
// page, so relabel Gutenberg's create button. "Create: %s" (text and image
// links) and "Create page: %s" (the button block) are core default-domain
// strings; overriding them here, on a bundle that only loads on the Cortext
// page, fixes the wording without forking the link UI.
const createDocumentLabel =
	/* translators: %s: the text typed into the link picker. */
	__( 'Create document: <mark>%s</mark>', 'cortext' );
setLocaleData( {
	'Create: <mark>%s</mark>': [ createDocumentLabel ],
	'Create page: <mark>%s</mark>': [ createDocumentLabel ],
} );

export { COLLECTIONS_BLOCK_CATEGORY };

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
