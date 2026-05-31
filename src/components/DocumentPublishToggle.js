import { __, sprintf } from '@wordpress/i18n';
import {
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { store as coreStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { useCallback, useState } from '@wordpress/element';

import PublishToggle from './PublishToggle';
import useCollectionDependentPages from '../hooks/useCollectionDependentPages';
import { definesTrait } from '../documents/capabilities';
import { isPublicWebAffordancesEnabled } from '../settings';

const CASCADE_PUBLISH_ERROR_NOTICE_ID = 'cortext-document-publish-error';

function referencedCollectionIds( blocks ) {
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

export default function DocumentPublishToggle( { postId } ) {
	const publicWebAffordances = isPublicWebAffordancesEnabled();
	const { editPost, savePost } = useDispatch( editorStore );
	const { saveEntityRecord } = useDispatch( coreStore );
	const { createErrorNotice, removeNotice } = useDispatch( noticesStore );

	const { status, link, title, isSaving, blocks, isCollection } = useSelect(
		( select ) => {
			const editor = select( editorStore );
			const record = select( coreStore ).getEntityRecord(
				'postType',
				'crtxt_document',
				postId
			);
			return {
				status: editor.getEditedPostAttribute( 'status' ),
				link: editor.getEditedPostAttribute( 'link' ),
				title: editor.getEditedPostAttribute( 'title' ),
				isSaving: editor.isSavingPost(),
				blocks: select( blockEditorStore ).getBlocks(),
				isCollection: definesTrait( record ),
			};
		},
		[ postId ]
	);

	const isPublic = status === 'publish';
	// A collection can be embedded in other documents through a data-view block,
	// so unpublishing it may strand public dependents. Identity is the mirror
	// term (`cortext_defines_trait`), true even for a collection with no custom
	// fields, so the dependency check keys off that, not a field count.
	const isReferenceable = isCollection;

	const [ isConfirming, setIsConfirming ] = useState( false );
	const { isLoading, dependentPages, error } = useCollectionDependentPages(
		postId,
		{ enabled: isConfirming && isReferenceable }
	);

	const togglePublishStatus = useCallback( async () => {
		if ( ! isPublic ) {
			const collectionIds = referencedCollectionIds( blocks );
			if ( collectionIds.length > 0 ) {
				const results = await Promise.allSettled(
					collectionIds.map( ( id ) =>
						saveEntityRecord(
							'postType',
							'crtxt_document',
							{ id, status: 'publish' },
							{ throwOnError: true }
						)
					)
				);
				if ( results.some( ( r ) => r.status === 'rejected' ) ) {
					createErrorNotice(
						__(
							"Couldn't publish referenced documents that contain rows. The document was not published.",
							'cortext'
						),
						{
							id: CASCADE_PUBLISH_ERROR_NOTICE_ID,
							type: 'snackbar',
						}
					);
					return;
				}
				removeNotice( CASCADE_PUBLISH_ERROR_NOTICE_ID );
			}
		}
		editPost( { status: isPublic ? 'private' : 'publish' } );
		savePost();
	}, [
		editPost,
		savePost,
		saveEntityRecord,
		createErrorNotice,
		removeNotice,
		isPublic,
		blocks,
	] );

	const confirmUnpublish = useCallback( () => {
		setIsConfirming( false );
		togglePublishStatus();
	}, [ togglePublishStatus ] );

	if ( ! publicWebAffordances || status === 'draft' ) {
		return null;
	}

	return (
		<>
			<PublishToggle
				isPublic={ isPublic }
				isSaving={ isSaving }
				link={ link }
				onToggle={ togglePublishStatus }
				onRequestUnpublish={
					isReferenceable ? () => setIsConfirming( true ) : undefined
				}
			/>
			{ isConfirming && isReferenceable ? (
				<ConfirmDialog
					style={ { maxWidth: '40rem' } }
					onConfirm={ confirmUnpublish }
					onCancel={ () => setIsConfirming( false ) }
					confirmButtonText={ __( 'Unpublish', 'cortext' ) }
				>
					<h2>
						{ sprintf(
							/* translators: %s: document title */
							__( 'Unpublish "%s"?', 'cortext' ),
							title || __( '(untitled)', 'cortext' )
						) }
					</h2>
					{ isLoading && (
						<p>
							{ __(
								'Checking for public dependent documents…',
								'cortext'
							) }
						</p>
					) }
					{ error && (
						<p>
							{ __(
								'Could not check for public dependent documents.',
								'cortext'
							) }
						</p>
					) }
					{ dependentPages && dependentPages.length > 0 && (
						<>
							<p>
								{ __(
									'The following documents are currently public and reference this document.',
									'cortext'
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
