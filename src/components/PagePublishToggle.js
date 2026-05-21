import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { store as coreStore } from '@wordpress/core-data';
import { useCallback } from '@wordpress/element';

import PublishToggle from './PublishToggle';

/**
 * Walks the block tree and returns unique collectionId values from all
 * cortext/data-view blocks.
 *
 * @param {Array} blocks Block list to walk.
 * @return {number[]} Unique collection IDs.
 */
function getCollectionIds( blocks ) {
	const ids = new Set();
	( function walk( list ) {
		for ( const block of list ) {
			if (
				block.name === 'cortext/data-view' &&
				block.attributes.collectionId
			) {
				ids.add( block.attributes.collectionId );
			}
			if ( block.innerBlocks?.length ) {
				walk( block.innerBlocks );
			}
		}
	} )( blocks );
	return [ ...ids ];
}

export default function PagePublishToggle() {
	const { editPost, savePost } = useDispatch( editorStore );
	const { saveEntityRecord } = useDispatch( coreStore );
	const { status, link, isSaving, blocks } = useSelect( ( select ) => {
		const editor = select( editorStore );
		return {
			status: editor.getEditedPostAttribute( 'status' ),
			link: editor.getEditedPostAttribute( 'link' ),
			isSaving: editor.isSavingPost(),
			blocks: select( blockEditorStore ).getBlocks(),
		};
	}, [] );

	const isPublic = status === 'publish';

	const toggle = useCallback( async () => {
		// Publishing the page also publishes any referenced collections
		// so their rows become publicly queryable. Unpublishing is one-sided
		// — collections stay as they are.
		if ( ! isPublic ) {
			const collectionIds = getCollectionIds( blocks );
			await Promise.all(
				collectionIds.map( ( id ) =>
					saveEntityRecord( 'postType', 'crtxt_collection', {
						id,
						status: 'publish',
					} )
				)
			);
		}

		editPost( { status: isPublic ? 'private' : 'publish' } );
		savePost();
	}, [ editPost, savePost, saveEntityRecord, isPublic, blocks ] );

	// Hide the toggle for draft pages (no title yet).
	if ( status === 'draft' ) {
		return null;
	}

	return (
		<PublishToggle
			isPublic={ isPublic }
			isSaving={ isSaving }
			link={ link }
			onToggle={ toggle }
		/>
	);
}
