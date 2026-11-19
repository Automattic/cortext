import { __ } from '@wordpress/i18n';
import { useCallback, useState } from '@wordpress/element';

import { EMPTY_COUNTS } from '../SidebarLifecycleList';
import TrashConfirmDialog from './TrashConfirmDialog';
import { useDocumentActions } from '../../documents';

/**
 * Restore and permanent delete for a Trash list, with the delete confirmation
 * the caller renders.
 *
 * @param {Object} list State from `useSidebarLifecycleList`.
 * @return {{ restore: Function, requestDelete: Function, confirmDialog: ?Object }}
 *         Handlers, and the dialog element to render while a delete waits for
 *         confirmation.
 */
export default function useTrashActions( list ) {
	const { restore, permanentDelete } = useDocumentActions();
	const { descendantCountById, runRowAction } = list;
	const [ pendingDelete, setPendingDelete ] = useState( null );

	const handleRestore = useCallback(
		( record ) =>
			runRowAction(
				record,
				() => restore( record ),
				__( 'Could not restore this document.', 'cortext' )
			),
		[ restore, runRowAction ]
	);

	const handleDelete = useCallback(
		( record ) => {
			setPendingDelete( null );
			return runRowAction(
				record,
				() => permanentDelete( record ),
				__( 'Could not delete this document.', 'cortext' )
			);
		},
		[ permanentDelete, runRowAction ]
	);

	const confirmDialog =
		pendingDelete !== null ? (
			<TrashConfirmDialog
				record={ pendingDelete }
				counts={
					descendantCountById.get( pendingDelete.id ) ?? EMPTY_COUNTS
				}
				onConfirm={ handleDelete }
				onCancel={ () => setPendingDelete( null ) }
			/>
		) : null;

	return {
		restore: handleRestore,
		requestDelete: setPendingDelete,
		confirmDialog,
	};
}
