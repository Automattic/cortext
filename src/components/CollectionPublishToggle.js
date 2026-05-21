import { __, sprintf } from '@wordpress/i18n';
import {
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { store as coreStore, useEntityRecord } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { useCallback, useState } from '@wordpress/element';

import { collectionTitle } from './CollectionRow';
import PublishToggle from './PublishToggle';
import useCollectionDependentPages from '../hooks/useCollectionDependentPages';

const COLLECTION_POST_TYPE = 'crtxt_collection';

export default function CollectionPublishToggle( { collectionId } ) {
	const { record } = useEntityRecord(
		'postType',
		COLLECTION_POST_TYPE,
		collectionId
	);
	const { saveEntityRecord } = useDispatch( coreStore );
	const isSaving = useSelect(
		( select ) =>
			select( coreStore ).isSavingEntityRecord(
				'postType',
				COLLECTION_POST_TYPE,
				collectionId
			),
		[ collectionId ]
	);

	const isPublic = record?.status === 'publish';

	const [ isConfirming, setIsConfirming ] = useState( false );
	const { isLoading, dependentPages, error } = useCollectionDependentPages(
		collectionId,
		{ enabled: isConfirming }
	);

	const toggle = useCallback( () => {
		saveEntityRecord( 'postType', COLLECTION_POST_TYPE, {
			id: collectionId,
			status: isPublic ? 'private' : 'publish',
		} );
	}, [ saveEntityRecord, collectionId, isPublic ] );

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
					confirmButtonText={ __( 'Unpublish anyway', 'cortext' ) }
				>
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
							<h2>
								{ sprintf(
									/* translators: %s: collection title */
									__(
										'Unpublish collection "%s"?',
										'cortext'
									),
									collectionTitle( record )
								) }
							</h2>
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
