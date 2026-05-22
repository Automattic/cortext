import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { store as coreStore } from '@wordpress/core-data';
import { Button } from '@wordpress/components';
import { useCallback, useState } from '@wordpress/element';
import { globe, lock } from '@wordpress/icons';

/**
 * Walks the block tree and returns each collection used by cortext/data-view.
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

export default function PublishToggle() {
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

	const [ copied, setCopied ] = useState( false );

	const isPublic = status === 'publish';

	const toggle = useCallback( async () => {
		// Publish collections used by DataView blocks along with the page, so
		// their rows are available to the frontend render.
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

	const copyLink = useCallback( async () => {
		if ( link ) {
			await navigator.clipboard.writeText( link );
			setCopied( true );
			setTimeout( () => setCopied( false ), 2000 );
		}
	}, [ link ] );

	// Hide the toggle for draft pages until they have a title.
	if ( status === 'draft' ) {
		return null;
	}

	return (
		<div className="cortext-publish-toggle">
			<Button
				icon={ isPublic ? globe : lock }
				onClick={ toggle }
				disabled={ isSaving }
				variant="tertiary"
				size="compact"
				isPressed={ isPublic }
			>
				{ isPublic
					? __( 'Public', 'cortext' )
					: __( 'Publish', 'cortext' ) }
			</Button>
			{ isPublic && link ? (
				<Button
					variant="link"
					className="cortext-publish-toggle__copy"
					onClick={ copyLink }
					size="compact"
				>
					{ copied
						? __( 'Copied!', 'cortext' )
						: __( 'Copy link', 'cortext' ) }
				</Button>
			) : null }
		</div>
	);
}
