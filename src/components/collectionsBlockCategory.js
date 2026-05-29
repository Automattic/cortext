// Register the Collections block category before the `../blocks` barrel
// imports the four Cortext block definitions. Gutenberg checks
// `settings.category` against the category list during `registerBlockType`
// and drops unknown values (see
// `@wordpress/blocks/src/store/process-block-type.ts`). Without this,
// block.json's "category": "collections" is ignored and the blocks land
// uncategorized in the inserter.
import { getCategories, setCategories } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';

export const COLLECTIONS_BLOCK_CATEGORY = {
	slug: 'collections',
	title: __( 'Collections', 'cortext' ),
	icon: null,
};

export function ensureCollectionsCategory() {
	const existing = getCategories();
	if (
		! existing.some( ( c ) => c.slug === COLLECTIONS_BLOCK_CATEGORY.slug )
	) {
		setCategories( [ COLLECTIONS_BLOCK_CATEGORY, ...existing ] );
	}
}

ensureCollectionsCategory();
