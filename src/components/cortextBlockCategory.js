// Register Cortext's block category before the `../blocks` barrel imports the
// four block definitions. Gutenberg checks `settings.category` against the
// category list during `registerBlockType` and drops unknown values (see
// `@wordpress/blocks/src/store/process-block-type.ts`). Without this,
// block.json's "category": "cortext" is ignored and the blocks land
// uncategorized in the inserter.
import { getCategories, setCategories } from '@wordpress/blocks';
import { __ } from '@wordpress/i18n';

export const CORTEXT_BLOCK_CATEGORY = {
	slug: 'cortext',
	title: __( 'Cortext', 'cortext' ),
	icon: null,
};

export function ensureCortextCategory() {
	const existing = getCategories();
	if ( ! existing.some( ( c ) => c.slug === CORTEXT_BLOCK_CATEGORY.slug ) ) {
		setCategories( [ CORTEXT_BLOCK_CATEGORY, ...existing ] );
	}
}

ensureCortextCategory();
