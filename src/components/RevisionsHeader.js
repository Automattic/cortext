import {
	Button,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { dateI18n, getDate, getSettings } from '@wordpress/date';
import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { closeSmall, reset, seen, unseen } from '@wordpress/icons';

import { useRevisionControls } from '../hooks/useRevisions';

function revisionLabel( revision ) {
	const date = revision?.date ?? revision?.modified;
	if ( ! date ) {
		return __( 'Viewing revision', 'cortext' );
	}
	return sprintf(
		/* translators: %s: revision date. */
		__( 'Revision saved %s', 'cortext' ),
		dateI18n( getSettings().formats.datetimeAbbreviated, getDate( date ) )
	);
}

export default function RevisionsHeader( { postId, postType } ) {
	const [ isConfirming, setIsConfirming ] = useState( false );
	const {
		canRestore,
		currentRevision,
		exitRevisions,
		isDirty,
		isRestoring,
		isSaving,
		isShowingRevisionDiff,
		isTrashed,
		restoreRevision,
		toggleDiff,
	} = useRevisionControls( { postId, postType } );

	let restoreReason = __( 'Restore revision', 'cortext' );
	if ( isTrashed ) {
		restoreReason = __(
			'Take this page out of Trash before restoring a revision.',
			'cortext'
		);
	} else if ( isDirty || isSaving ) {
		restoreReason = __(
			'Save your changes first, then restore the revision.',
			'cortext'
		);
	}

	return (
		<div className="cortext-revisions-header">
			<span className="cortext-revisions-header__label">
				{ revisionLabel( currentRevision ) }
			</span>
			<Button
				icon={ isShowingRevisionDiff ? unseen : seen }
				label={
					isShowingRevisionDiff
						? __( 'Hide changes', 'cortext' )
						: __( 'Show changes', 'cortext' )
				}
				isPressed={ isShowingRevisionDiff }
				onClick={ () => toggleDiff() }
				size="compact"
			/>
			<Button
				icon={ reset }
				label={ restoreReason }
				showTooltip
				accessibleWhenDisabled
				variant="primary"
				isBusy={ isRestoring }
				disabled={ ! canRestore || isRestoring }
				onClick={ () => setIsConfirming( true ) }
				size="compact"
			>
				{ __( 'Restore', 'cortext' ) }
			</Button>
			<Button
				icon={ closeSmall }
				label={ __( 'Back to editor', 'cortext' ) }
				onClick={ exitRevisions }
				size="compact"
			/>
			{ isConfirming ? (
				<ConfirmDialog
					onConfirm={ async () => {
						setIsConfirming( false );
						await restoreRevision();
					} }
					onCancel={ () => setIsConfirming( false ) }
					confirmButtonText={ __( 'Restore', 'cortext' ) }
					cancelButtonText={ __( 'Cancel', 'cortext' ) }
				>
					{ __(
						"Restore this revision? We'll keep the current version in history so you can return to it later.",
						'cortext'
					) }
				</ConfirmDialog>
			) : null }
		</div>
	);
}
