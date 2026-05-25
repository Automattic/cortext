import { __, sprintf } from '@wordpress/i18n';
import {
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback, useState } from '@wordpress/element';

import { documentTitle as collectionTitle } from '../documents';
import PublishToggle from './PublishToggle';
import useCollectionDependentPages from '../hooks/useCollectionDependentPages';

const COLLECTION_POST_TYPE = 'crtxt_collection';

export default function CollectionPublishToggle( { collectionId } ) {
	// Keep useEntityRecord for the dialog title. Publish/unpublish goes through
	// editorStore so dirty title, cover, and data-view edits flush with status.
	const { record } = useEntityRecord(
		'postType',
		COLLECTION_POST_TYPE,
		collectionId
	);
	const { editPost, savePost } = useDispatch( editorStore );
	const { status, isSaving } = useSelect( ( select ) => {
		const editor = select( editorStore );
		return {
			status: editor.getEditedPostAttribute( 'status' ),
			isSaving: editor.isSavingPost(),
		};
	}, [] );

	const isPublic = status === 'publish';

	const [ isConfirming, setIsConfirming ] = useState( false );
	const { isLoading, dependentPages, error } = useCollectionDependentPages(
		collectionId,
		{ enabled: isConfirming }
	);

	const toggle = useCallback( () => {
		editPost( { status: isPublic ? 'private' : 'publish' } );
		savePost();
	}, [ editPost, savePost, isPublic ] );

	const confirmUnpublish = useCallback( () => {
		setIsConfirming( false );
		toggle();
	}, [ toggle ] );

	if ( ! record ) {
		return null;
	}

	return (
		<>
			<PublishToggle
				isPublic={ isPublic }
				isSaving={ isSaving }
				onToggle={ toggle }
				onRequestUnpublish={ () => setIsConfirming( true ) }
			/>
			{ isConfirming ? (
				<ConfirmDialog
					style={ { maxWidth: '40rem' } }
					onConfirm={ confirmUnpublish }
					onCancel={ () => setIsConfirming( false ) }
					confirmButtonText={ __( 'Unpublish', 'cortext' ) }
				>
					<h2>
						{ sprintf(
							/* translators: %s: collection title */
							__( 'Unpublish collection "%s"?', 'cortext' ),
							collectionTitle( record )
						) }
					</h2>
					{ isLoading && (
						<p>
							{ __(
								'Checking for public dependent pages…',
								'cortext'
							) }
						</p>
					) }
					{ error && (
						<p>
							{ __(
								'Could not check for public dependent pages.',
								'cortext'
							) }
						</p>
					) }
					{ dependentPages && dependentPages.length > 0 && (
						<>
							<p>
								{ __(
									'The following pages are currently public and depend on this collection.',
									'cortext'
								) }{ ' ' }
								{ sprintf(
									/* translators: %s: collection title */
									__(
										'If you unpublish collection "%s", visitors of those pages will no longer be able to view it.',
										'cortext'
									),
									collectionTitle( record )
								) }
							</p>
							<ul
								style={ {
									listStyle: 'disc',
									paddingInlineStart: '1.5em',
								} }
							>
								{ dependentPages.map( ( page ) => (
									<li key={ page.id }>
										{ page.title ||
											__( '(untitled)', 'cortext' ) }
									</li>
								) ) }
							</ul>
						</>
					) }
				</ConfirmDialog>
			) : null }
		</>
	);
}
