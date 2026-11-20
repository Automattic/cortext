import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useState } from '@wordpress/element';
import {
	Button,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import { trash as trashIcon } from '@wordpress/icons';

import { useDocumentActions } from '../../documents';

/**
 * The Trash header action: empties Trash after a confirmation.
 *
 * @param {Object} props
 * @param {number} props.count Items listed in Trash.
 */
export default function EmptyTrashButton( { count } ) {
	const { emptyTrash } = useDocumentActions();
	const { createErrorNotice, createSuccessNotice } =
		useDispatch( 'core/notices' );
	const [ isConfirming, setIsConfirming ] = useState( false );
	const [ isEmptying, setIsEmptying ] = useState( false );

	const handleEmptyTrash = useCallback( async () => {
		setIsConfirming( false );
		setIsEmptying( true );
		try {
			const response = await emptyTrash();
			const deleted = response?.deleted?.length ?? 0;
			createSuccessNotice(
				sprintf(
					/* translators: %d: number of documents deleted for good */
					_n(
						'%d document deleted permanently.',
						'%d documents deleted permanently.',
						deleted,
						'cortext'
					),
					deleted
				),
				{ id: 'cortext-trash-emptied', type: 'snackbar' }
			);
		} catch ( error ) {
			createErrorNotice(
				error?.message ?? __( 'Could not empty Trash.', 'cortext' ),
				{ id: 'cortext-trash-emptied', type: 'snackbar' }
			);
		} finally {
			setIsEmptying( false );
		}
	}, [ createErrorNotice, createSuccessNotice, emptyTrash ] );

	return (
		<>
			<Button
				className="cortext-sidebar__section-action cortext-lifecycle__empty-button"
				icon={ trashIcon }
				size="small"
				label={ __( 'Empty Trash…', 'cortext' ) }
				disabled={ isEmptying }
				onClick={ () => setIsConfirming( true ) }
			/>
			{ isConfirming && (
				<ConfirmDialog
					onConfirm={ handleEmptyTrash }
					onCancel={ () => setIsConfirming( false ) }
					confirmButtonText={ __( 'Empty Trash', 'cortext' ) }
				>
					{ sprintf(
						/* translators: %d: number of items in Trash */
						_n(
							"Delete %d item in Trash permanently? This can't be undone.",
							"Delete all %d items in Trash permanently? This can't be undone.",
							count,
							'cortext'
						),
						count
					) }
				</ConfirmDialog>
			) }
		</>
	);
}
