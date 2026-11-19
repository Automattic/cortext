import { __, sprintf } from '@wordpress/i18n';
import { useCallback } from '@wordpress/element';
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
import { __experimentalConfirmDialog as ConfirmDialog } from '@wordpress/components';

import { useDocumentRecord } from '../../documents';

/**
 * Confirmation for moving an archived document to Trash, which starts its
 * 30 days there.
 *
 * @param {Object}   props
 * @param {Object}   props.record    Archived record pending the move.
 * @param {Function} props.onConfirm Parent callback `(record)`.
 * @param {Function} props.onCancel  Closes the dialog without moving it.
 */
export default function ArchivedTrashConfirmDialog( {
	record,
	onConfirm,
	onCancel,
} ) {
	const { title } = useDocumentRecord( record );
	const handleConfirm = useCallback( () => {
		onConfirm( record );
	}, [ onConfirm, record ] );

	return (
		<ConfirmDialog
			onConfirm={ handleConfirm }
			onCancel={ onCancel }
			confirmButtonText={ __( 'Move to Trash', 'cortext' ) }
		>
			{ sprintf(
				/* translators: %s: document title */
				__(
					'Move “%s” to Trash? Nested documents will also move to Trash. Items in Trash are permanently deleted after 30 days.',
					'cortext'
				),
				title
			) }
		</ConfirmDialog>
	);
}
