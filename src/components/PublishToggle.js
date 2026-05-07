import { __ } from '@wordpress/i18n';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { store as coreStore } from '@wordpress/core-data';
import { Button } from '@wordpress/components';
import { useCallback, useState } from '@wordpress/element';
import { globe, lock } from '@wordpress/icons';

/**
 * Walks the block tree and returns unique collectionId values from all
 * cortext/data-view blocks.
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
		// Publishing the page also publishes any referenced collections
		// so their rows become publicly queryable.
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

	// Don't show the toggle for draft pages (no title yet).
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
