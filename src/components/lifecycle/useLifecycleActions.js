import { useCallback, useState } from '@wordpress/element';

import { EMPTY_COUNTS } from './useLifecycleList';
import { useDocumentActions } from '../../documents';

/**
 * Restore and the secondary action (permanent delete, or move to Trash) for a
 * lifecycle list, with the confirmation the caller renders.
 *
 * @param {Object} state Lifecycle state from `lifecycleStates`.
 * @param {Object} list  State from `useLifecycleList`.
 * @return {{ restore: Function, requestSecondary: Function, confirmDialog: ?Object }}
 *         Handlers, and the dialog element to render while the secondary
 *         action waits for confirmation.
 */
export default function useLifecycleActions( state, list ) {
	const actions = useDocumentActions();
	const restoreAction = state.restore( actions );
	const secondaryAction = state.secondary( actions );
	const { descendantCountById, runRowAction } = list;
	const [ pending, setPending ] = useState( null );
	const { restoreError, secondaryError } = state.copy();

	const restore = useCallback(
		( record ) =>
			runRowAction( record, () => restoreAction( record ), restoreError ),
		[ restoreAction, restoreError, runRowAction ]
	);

	const handleSecondary = useCallback(
		( record ) => {
			setPending( null );
			return runRowAction(
				record,
				() => secondaryAction( record ),
				secondaryError
			);
		},
		[ runRowAction, secondaryAction, secondaryError ]
	);

	const { SecondaryConfirmDialog } = state;
	const confirmDialog =
		pending !== null ? (
			<SecondaryConfirmDialog
				record={ pending }
				counts={ descendantCountById.get( pending.id ) ?? EMPTY_COUNTS }
				onConfirm={ handleSecondary }
				onCancel={ () => setPending( null ) }
			/>
		) : null;

	return {
		restore,
		requestSecondary: setPending,
		confirmDialog,
	};
}
