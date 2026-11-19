import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from '@wordpress/element';
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
import { __experimentalConfirmDialog as ConfirmDialog } from '@wordpress/components';

import computeCascadeRoots from './computeCascadeRoots';
import SidebarLifecycleList, {
	EMPTY_LIFECYCLE_DOCUMENTS_STATE,
	useSidebarLifecycleList,
} from './lifecycle/useLifecycleList';
import { useDocumentActions, useDocumentRecord } from '../documents';

const ARCHIVE_MARKER_META_KEYS = [
	'_cortext_archived_by_parent',
	'_cortext_archived_by_collection',
];

export function computeSidebarArchiveRoots( archivedDocuments = [] ) {
	return computeCascadeRoots( archivedDocuments, ARCHIVE_MARKER_META_KEYS );
}

function SidebarArchiveTrashConfirmDialog( { record, onConfirm, onCancel } ) {
	const { title } = useDocumentRecord( record );
	const message = sprintf(
		/* translators: %s: document title */
		__(
			'Move “%s” to Trash? Nested documents will also move to Trash. Items in Trash are permanently deleted after 30 days.',
			'cortext'
		),
		title
	);

	return (
		<ConfirmDialog
			onConfirm={ () => onConfirm( record ) }
			onCancel={ onCancel }
			confirmButtonText={ __( 'Move to Trash', 'cortext' ) }
		>
			{ message }
		</ConfirmDialog>
	);
}

export default function SidebarArchive( {
	activePages,
	selectedId,
	selectedCollectionId = null,
	archivedDocumentsState = EMPTY_LIFECYCLE_DOCUMENTS_STATE,
} ) {
	const { unarchive, trash: trashDocument } = useDocumentActions();
	const [ pendingTrash, setPendingTrash ] = useState( null );
	const list = useSidebarLifecycleList(
		archivedDocumentsState,
		activePages,
		ARCHIVE_MARKER_META_KEYS
	);
	const { runRowAction } = list;

	const handleRestore = useCallback(
		( record ) =>
			runRowAction(
				record,
				() => unarchive( record ),
				__( 'Could not restore this document.', 'cortext' )
			),
		[ runRowAction, unarchive ]
	);

	const handleTrash = useCallback(
		( record ) => {
			setPendingTrash( null );
			return runRowAction(
				record,
				() => trashDocument( record ),
				__( 'Could not move this document to Trash.', 'cortext' )
			);
		},
		[ runRowAction, trashDocument ]
	);

	return (
		<>
			<SidebarLifecycleList
				list={ list }
				isSelected={ ( record ) =>
					selectedId === record.id ||
					selectedCollectionId === record.id
				}
				errorMessage={ __(
					'Could not load archived documents.',
					'cortext'
				) }
				emptyMessage={ __( 'No archived documents.', 'cortext' ) }
				onRetry={ archivedDocumentsState.refresh }
				onRestore={ handleRestore }
				secondaryLabel={ __( 'Move to Trash', 'cortext' ) }
				onSecondaryAction={ setPendingTrash }
			/>
			{ pendingTrash !== null && (
				<SidebarArchiveTrashConfirmDialog
					record={ pendingTrash }
					onConfirm={ handleTrash }
					onCancel={ () => setPendingTrash( null ) }
				/>
			) }
		</>
	);
}
