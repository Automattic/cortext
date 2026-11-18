import { __ } from '@wordpress/i18n';
import { useDispatch } from '@wordpress/data';
import { useCallback, useState } from '@wordpress/element';
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
import { __experimentalConfirmDialog as ConfirmDialog } from '@wordpress/components';

import SidebarLifecycleList, {
	EMPTY_COUNTS,
	EMPTY_LIFECYCLE_DOCUMENTS_STATE,
	useSidebarLifecycleList,
} from './SidebarLifecycleList';
import TypeToConfirmDialog from './TypeToConfirmDialog';
import computeCascadeRoots from './computeCascadeRoots';
import { POST_TYPE, TRASHED_PAGES_QUERY } from './page-queries';
import { useDocumentActions, useDocumentRecord } from '../documents';

// Mirror the PHP `TrashCascade` markers. The cascade stamps a different key
// depending on whether the descendant was trashed as a child page or as a row
// of a collection, but the value carries the same meaning ("trashed by this
// document"), so the sidebar treats either marker as a pointer back to the
// cascade root.
const TRASH_MARKER_META_KEYS = [
	'_cortext_trashed_by_parent',
	'_cortext_trashed_by_collection',
];

export function computeSidebarTrashRoots( trashedDocuments = [] ) {
	return computeCascadeRoots( trashedDocuments, TRASH_MARKER_META_KEYS );
}

/**
 * Confirmation for permanent delete. The descriptor decides whether this can
 * use a plain confirm dialog or needs the typed-name flow.
 *
 * @param {Object}   props
 * @param {Object}   props.record    Trashed record pending delete.
 * @param {Object}   props.counts    Cascade counts for the pending root.
 * @param {Function} props.onConfirm Parent callback `(record)`.
 * @param {Function} props.onCancel  Closes the dialog without deleting.
 */
function SidebarTrashConfirmDialog( { record, counts, onConfirm, onCancel } ) {
	const { title, permanentDeleteDocumentConfirmation } =
		useDocumentRecord( record );
	const dialogConfig = permanentDeleteDocumentConfirmation( counts ) ?? {
		title: '',
		message: '',
	};

	const handleConfirm = useCallback( () => {
		onConfirm( record );
	}, [ onConfirm, record ] );

	if ( dialogConfig.requireTypeToConfirm ) {
		return (
			<TypeToConfirmDialog
				title={ dialogConfig.title }
				message={ dialogConfig.message }
				confirmPhrase={ title }
				confirmLabel={ __( 'Delete permanently', 'cortext' ) }
				onConfirm={ handleConfirm }
				onCancel={ onCancel }
			/>
		);
	}

	return (
		<ConfirmDialog
			onConfirm={ handleConfirm }
			onCancel={ onCancel }
			confirmButtonText={ __( 'Delete permanently', 'cortext' ) }
		>
			{ dialogConfig.message }
		</ConfirmDialog>
	);
}

/**
 * Sidebar Trash for Cortext documents.
 *
 * Trash shows cascade roots. Children trashed with a parent are restored or
 * deleted with that parent. If a marker points to a parent that is no longer
 * in Trash, the orphan still appears so it can be recovered.
 *
 * Restore and permanent delete go through the descriptors, keeping per-case
 * refreshes and error copy out of this component.
 *
 * @param {Object}      props
 * @param {Array}       props.activePages           Active page records for
 *                                                  breadcrumb lookup.
 * @param {number|null} props.selectedId            Currently-selected page id, used
 *                                                  to highlight a trashed document when
 *                                                  the canvas is showing it.
 * @param {number|null} props.selectedCollectionId  Currently-selected collection id, so
 *                                                  permanent delete can navigate away
 *                                                  when the open collection (or one of
 *                                                  its rows) is gone.
 * @param {Function}    props.onSelect              Opens a trashed document in
 *                                                  the canvas.
 * @param {Object}      props.trashedDocumentsState Trashed document query state.
 */
export default function SidebarTrash( {
	activePages,
	selectedId,
	selectedCollectionId = null,
	onSelect,
	trashedDocumentsState = EMPTY_LIFECYCLE_DOCUMENTS_STATE,
} ) {
	const { invalidateResolution } = useDispatch( 'core' );
	const { restore, permanentDelete } = useDocumentActions();
	const [ pendingDelete, setPendingDelete ] = useState( null );
	const list = useSidebarLifecycleList(
		trashedDocumentsState,
		activePages,
		TRASH_MARKER_META_KEYS
	);
	const { descendantCountById, runRowAction } = list;

	const handleRestore = useCallback(
		( record ) =>
			runRowAction(
				record,
				() => restore( record ),
				__( 'Could not restore this document.', 'cortext' )
			),
		[ restore, runRowAction ]
	);

	const handlePermanentDelete = useCallback(
		( record ) => {
			setPendingDelete( null );
			return runRowAction(
				record,
				async () => {
					const response = await permanentDelete( record );
					const deletedIds = response?.deleted ?? [];
					// If the canvas was showing one of the deleted documents,
					// move away from it. Otherwise `useEntityRecord` returns
					// undefined and the canvas keeps spinning because the
					// document is gone, not just trashed. Collections track via
					// `selectedCollectionId`, so check both ids.
					const openId = selectedId ?? selectedCollectionId;
					if ( openId && deletedIds.includes( openId ) ) {
						onSelect( null );
					}
				},
				__( 'Could not delete this document.', 'cortext' )
			);
		},
		[
			onSelect,
			permanentDelete,
			runRowAction,
			selectedCollectionId,
			selectedId,
		]
	);

	const retryTrashFetch = useCallback( () => {
		invalidateResolution( 'getEntityRecords', [
			'postType',
			POST_TYPE,
			TRASHED_PAGES_QUERY,
		] );
		trashedDocumentsState.refresh?.();
	}, [ invalidateResolution, trashedDocumentsState ] );

	return (
		<>
			<SidebarLifecycleList
				list={ list }
				isSelected={ ( record ) => selectedId === record.id }
				errorMessage={ __( 'Could not load Trash.', 'cortext' ) }
				emptyMessage={ __( 'Trash is empty.', 'cortext' ) }
				onRetry={ retryTrashFetch }
				onRestore={ handleRestore }
				secondaryLabel={ __( 'Delete permanently', 'cortext' ) }
				onSecondaryAction={ setPendingDelete }
			/>
			{ pendingDelete !== null && (
				<SidebarTrashConfirmDialog
					record={ pendingDelete }
					counts={
						descendantCountById.get( pendingDelete.id ) ??
						EMPTY_COUNTS
					}
					onConfirm={ handlePermanentDelete }
					onCancel={ () => setPendingDelete( null ) }
				/>
			) }
		</>
	);
}
