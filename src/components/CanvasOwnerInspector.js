import { createSlotFill } from '@wordpress/components';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { useSelect } from '@wordpress/data';

// Maps a Canvas post type to its one allowed body block. Owner blocks join the
// header set, hide the Block tab, fill the document tab, and drop the usual
// block chrome. See tech-debt.md#td-collection-owner-body-contract.
//
// `matches` lets the data-view block disambiguate the owned instance from any
// inline data-view that happens to point at this collection.
const CANVAS_OWNER_BLOCKS = {
	crtxt_collection: {
		blockName: 'cortext/data-view',
		matches: ( block, postId ) =>
			Number( block?.attributes?.collectionId ) === Number( postId ),
		initialAttributes: ( postId ) => ( {
			collectionId: Number( postId ),
			align: 'full',
			lock: { move: true, remove: true },
		} ),
	},
};

export function getCanvasOwnerBlockName( postType ) {
	return CANVAS_OWNER_BLOCKS[ postType ]?.blockName ?? null;
}

// Block-specific defaults for EditorBody when it has to recreate the owner.
export function getCanvasOwnerInitialAttributes( postType, postId ) {
	const entry = CANVAS_OWNER_BLOCKS[ postType ];
	return entry?.initialAttributes ? entry.initialAttributes( postId ) : null;
}

function matchesOwner( postType, block, postId ) {
	const entry = CANVAS_OWNER_BLOCKS[ postType ];
	if ( ! entry || ! block || block.name !== entry.blockName ) {
		return false;
	}
	return entry.matches ? entry.matches( block, postId ) : true;
}

// Finds the canvas-owner block instance among root blocks. The reconciler
// uses this so a foreign data-view (pointing at a different collection) does
// not satisfy the "owner present" check and skip seeding.
export function findCanvasOwnerBlock( blocks, postType, postId ) {
	if ( ! Array.isArray( blocks ) || ! getCanvasOwnerBlockName( postType ) ) {
		return null;
	}
	return (
		blocks.find( ( block ) => matchesOwner( postType, block, postId ) ) ??
		null
	);
}

// Is this block the current document's owner?
export function useIsCanvasOwnerBlock( clientId, postType, postId ) {
	return useSelect(
		( select ) => {
			if ( ! clientId || ! getCanvasOwnerBlockName( postType ) ) {
				return false;
			}
			const block = select( blockEditorStore ).getBlock( clientId );
			return matchesOwner( postType, block, postId );
		},
		[ clientId, postType, postId ]
	);
}

// Is the selected root block the current document's owner?
export function useIsCanvasOwnerSelected( postType, postId ) {
	return useSelect(
		( select ) => {
			if ( ! getCanvasOwnerBlockName( postType ) ) {
				return false;
			}
			const store = select( blockEditorStore );
			const clientId = store.getSelectedBlockClientId();
			if ( ! clientId ) {
				return false;
			}
			const block = store.getBlock( clientId );
			return matchesOwner( postType, block, postId );
		},
		[ postType, postId ]
	);
}

const { Fill, Slot } = createSlotFill( 'CortextCanvasOwnerInspector' );

// The owner block still declares inspector panels in edit(); PageInspectorSidebar
// decides which tab shows them.
export default function CanvasOwnerInspector( { children } ) {
	return <Fill>{ children }</Fill>;
}

CanvasOwnerInspector.Slot = Slot;
