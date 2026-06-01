import { __ } from '@wordpress/i18n';
import { registerBlockVariation } from '@wordpress/blocks';
import { link, table } from '@wordpress/icons';

const BLOCK_NAME = 'cortext/data-view';

// Each variation carries a transient `intent` attribute that the block's edit
// reads once and clears on mount, so the inserter and slash menu offer two
// single-purpose entries ("create a new collection" vs "link an existing one")
// without persisting any extra attribute on saved blocks.
const matchesIntent = ( blockAttributes, variationAttributes ) =>
	blockAttributes.intent === variationAttributes.intent;

export const DATA_VIEW_VARIATIONS = [
	{
		name: 'cortext-collection-new',
		title: __( 'Collection', 'cortext' ),
		description: __(
			'Create a new collection and show it here.',
			'cortext'
		),
		// Keywords surface the collection entries near the top of inserter and
		// slash-menu searches for the terms people reach for ("database",
		// "table", "grid"), since there is no hard inserter-priority API.
		keywords: [
			__( 'collection', 'cortext' ),
			__( 'database', 'cortext' ),
			__( 'table', 'cortext' ),
			__( 'grid', 'cortext' ),
			__( 'list', 'cortext' ),
			__( 'data', 'cortext' ),
		],
		icon: table,
		attributes: { intent: 'create-inline' },
		// Replaces the bare block in the inserter so creating is the default
		// entry, leaving exactly two Collections items instead of three.
		isDefault: true,
		scope: [ 'inserter' ],
		isActive: matchesIntent,
	},
	{
		name: 'cortext-collection-linked',
		title: __( 'Linked collection view', 'cortext' ),
		description: __( 'Show an existing collection here.', 'cortext' ),
		keywords: [
			__( 'collection', 'cortext' ),
			__( 'database', 'cortext' ),
			__( 'linked', 'cortext' ),
			__( 'existing', 'cortext' ),
			__( 'reference', 'cortext' ),
		],
		icon: link,
		attributes: { intent: 'link-existing' },
		scope: [ 'inserter' ],
		isActive: matchesIntent,
	},
];

export function registerDataViewVariations() {
	DATA_VIEW_VARIATIONS.forEach( ( variation ) =>
		registerBlockVariation( BLOCK_NAME, variation )
	);
}
