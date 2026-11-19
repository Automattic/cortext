import { __ } from '@wordpress/i18n';
import { useCallback } from '@wordpress/element';
// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
import { __experimentalConfirmDialog as ConfirmDialog } from '@wordpress/components';

import TypeToConfirmDialog from '../TypeToConfirmDialog';
import { useDocumentRecord } from '../../documents';

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
export default function TrashConfirmDialog( {
	record,
	counts,
	onConfirm,
	onCancel,
} ) {
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
