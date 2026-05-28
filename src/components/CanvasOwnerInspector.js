import { createSlotFill } from '@wordpress/components';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { useEntityRecord } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';

// A document whose body renders through a single locked block ("owner") joins
// the header set, hides the Block tab, fills the document tab, and drops the
// usual block chrome. Today only schema-bearing documents have an owner: the
// `cortext/data-view` pointing back at themselves. See tech-debt.md#59.

const OWNER_BLOCK_NAME = 'cortext/data-view';

function recordHasSchema( record ) {
	const ids = record?.meta?.cortext_fields;
	return Array.isArray( ids ) && ids.length > 0;
}

function useDocumentHasSchema( postType, postId ) {
	const { record } = useEntityRecord( 'postType', postType, postId || 0 );
	return recordHasSchema( record );
}

export function getCanvasOwnerBlockNameForRecord( record ) {
	return recordHasSchema( record ) ? OWNER_BLOCK_NAME : null;
}

export function getCanvasOwnerInitialAttributesForRecord( record, postId ) {
	if ( ! recordHasSchema( record ) ) {
		return null;
	}
	return {
		collectionId: Number( postId ),
		align: 'full',
		lock: { move: true, remove: true },
	};
}

function matchesOwner( block, postId ) {
	if ( ! block || block.name !== OWNER_BLOCK_NAME ) {
		return false;
	}
	return Number( block?.attributes?.collectionId ) === Number( postId );
}

// Finds the canvas-owner block instance among root blocks. The reconciler
// uses this so a foreign data-view (pointing at a different collection) does
// not satisfy the "owner present" check and skip seeding.
export function findCanvasOwnerBlock( blocks, record, postId ) {
	if ( ! Array.isArray( blocks ) || ! recordHasSchema( record ) ) {
		return null;
	}
	return blocks.find( ( block ) => matchesOwner( block, postId ) ) ?? null;
}

// Is this block the current document's owner?
export function useIsCanvasOwnerBlock( clientId, postType, postId ) {
	const hasSchema = useDocumentHasSchema( postType, postId );
	return useSelect(
		( select ) => {
			if ( ! clientId || ! hasSchema ) {
				return false;
			}
			const block = select( blockEditorStore ).getBlock( clientId );
			return matchesOwner( block, postId );
		},
		[ clientId, hasSchema, postId ]
	);
}

// Is the selected root block the current document's owner?
export function useIsCanvasOwnerSelected( postType, postId ) {
	const hasSchema = useDocumentHasSchema( postType, postId );
	return useSelect(
		( select ) => {
			if ( ! hasSchema ) {
				return false;
			}
			const store = select( blockEditorStore );
			const clientId = store.getSelectedBlockClientId();
			if ( ! clientId ) {
				return false;
			}
			const block = store.getBlock( clientId );
			return matchesOwner( block, postId );
		},
		[ hasSchema, postId ]
	);
}

const { Fill, Slot } = createSlotFill( 'CortextCanvasOwnerInspector' );

// The owner block still declares inspector panels in edit(); DocumentInspectorSidebar
// decides which tab shows them.
export default function CanvasOwnerInspector( { children } ) {
	return <Fill>{ children }</Fill>;
}

CanvasOwnerInspector.Slot = Slot;
