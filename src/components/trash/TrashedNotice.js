import { __, _n, sprintf } from '@wordpress/i18n';
import { useState } from '@wordpress/element';
import { Notice } from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import { useNavigate, useParams } from '@tanstack/react-router';

import './TrashedNotice.scss';

import { useActiveEditor } from '../ActiveEditorContext';
import TrashConfirmDialog from './TrashConfirmDialog';
import { deletionLabel } from './trashItems';
import useTrashDetails from './useTrashDetails';
import {
	permanentlyDeleteDocument,
	restoreDocument,
} from '../../documents/actions';
import { isTrashUri, trashUri } from '../../router/useResolveEntity';

/**
 * The banner over a trashed document: when it was deleted and by whom, when it
 * goes away for good, what comes back with it, and the actions to restore it
 * or delete it now. It shows whether the document was opened from Trash or
 * from a link.
 *
 * @param {Object}   props
 * @param {number}   props.postId     Trashed document id.
 * @param {string}   props.postType   Its post type.
 * @param {Function} props.onRestored Called after a restore.
 */
export default function TrashedNotice( { postId, postType, onRestored } ) {
	const [ isBusy, setIsBusy ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ isConfirmingDelete, setIsConfirmingDelete ] = useState( false );
	const navigate = useNavigate();
	const params = useParams( { strict: false } );
	const details = useTrashDetails( postId );
	const { invalidateResolution, receiveEntityRecords } =
		useDispatch( 'core' );
	const { createErrorNotice, createSuccessNotice } =
		useDispatch( 'core/notices' );
	// The restore snackbar's Undo trashes the document again, so it needs the
	// editor hooks that save pending edits first.
	const { flushActiveEditor, lockEditors, waitForOpenDocuments } =
		useActiveEditor();
	const ctx = {
		createErrorNotice,
		createSuccessNotice,
		flushActiveEditor,
		invalidateResolution,
		lockEditors,
		receiveEntityRecords,
		waitForOpenDocuments,
	};
	const record = details?.record ?? { id: postId };

	const run = async ( action, fallbackMessage ) => {
		setError( null );
		setIsBusy( true );
		try {
			await action();
		} catch ( err ) {
			setError( err?.message ?? fallbackMessage );
		} finally {
			setIsBusy( false );
		}
	};

	const restore = () =>
		run(
			async () => {
				const response = await restoreDocument( record, ctx );
				onRestored?.( postId, postType, response );
			},
			__( 'Could not restore this document.', 'cortext' )
		);

	// The document is gone afterwards, so leave it: back to Trash when it was
	// opened from there, home otherwise.
	const deletePermanently = () => {
		setIsConfirmingDelete( false );
		return run(
			async () => {
				await permanentlyDeleteDocument( record, ctx );
				if ( isTrashUri( params._splat ?? '' ) ) {
					navigate( {
						to: '/$',
						params: { _splat: trashUri() },
						replace: true,
					} );
					return;
				}
				navigate( { to: '/' } );
			},
			__( 'Could not delete this document.', 'cortext' )
		);
	};

	const facts = details
		? [
				deletionLabel( details.record, details.byName ),
				details.nestedCount > 0
					? sprintf(
							/* translators: %d: number of nested documents restored with this one */
							_n(
								'%d nested document comes back with it',
								'%d nested documents come back with it',
								details.nestedCount,
								'cortext'
							),
							details.nestedCount
					  )
					: '',
		  ].filter( Boolean )
		: [];
	const restoreLabel = details?.path.length
		? sprintf(
				/* translators: %s: title of the page or collection the document is restored into */
				__( 'Restore to %s', 'cortext' ),
				details.path[ details.path.length - 1 ]
		  )
		: __( 'Restore', 'cortext' );

	return (
		<>
			<Notice
				className="cortext-canvas__notice cortext-trashed-notice"
				status="warning"
				isDismissible={ false }
				actions={ [
					{
						label: restoreLabel,
						onClick: restore,
						disabled: isBusy,
						variant: 'primary',
					},
					{
						label: __( 'Delete permanently', 'cortext' ),
						onClick: () => setIsConfirmingDelete( true ),
						disabled: isBusy || ! details,
						variant: 'tertiary',
						className: 'cortext-trashed-notice__delete',
					},
				] }
			>
				<p className="cortext-trashed-notice__title">
					{ error ??
						__( 'This document is in the Trash.', 'cortext' ) }
				</p>
				{ facts.length > 0 && (
					<p className="cortext-trashed-notice__facts">
						{ facts.join( ' · ' ) }
					</p>
				) }
			</Notice>
			{ isConfirmingDelete && details && (
				<TrashConfirmDialog
					record={ details.record }
					counts={ { total: details.nestedCount } }
					onConfirm={ deletePermanently }
					onCancel={ () => setIsConfirmingDelete( false ) }
				/>
			) }
		</>
	);
}
