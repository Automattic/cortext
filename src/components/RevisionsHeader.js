import {
	Button,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { dateI18n, getDate, getSettings } from '@wordpress/date';
import { useDispatch, useSelect } from '@wordpress/data';
import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { backup, cog, seen, unseen } from '@wordpress/icons';
import { store as interfaceStore } from '@wordpress/interface';

import { useRevisionControls } from '../hooks/useRevisions';
import {
	DOCUMENT_INSPECTOR,
	INSPECTOR_SCOPE,
	REVISION_HISTORY_PANEL,
} from './editorPanelConstants';

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

export default function RevisionsHeader( {
	isReadOnly = false,
	postId,
	postType,
} ) {
	const [ isConfirming, setIsConfirming ] = useState( false );
	const activeArea = useSelect(
		( select ) =>
			select( interfaceStore ).getActiveComplementaryArea(
				INSPECTOR_SCOPE
			),
		[]
	);
	const { enableComplementaryArea } = useDispatch( interfaceStore );
	const {
		canRestore,
		currentRevision,
		exitRevisions,
		isDirty,
		isPostLocked,
		isRestoring,
		isSaving,
		isShowingRevisionDiff,
		isTrashed,
		restoreRevision,
		toggleDiff,
	} = useRevisionControls( { isReadOnly, postId, postType } );

	let restoreReason = __( 'Restore revision', 'cortext' );
	if ( isTrashed ) {
		restoreReason = __(
			'Take this page out of Trash before restoring a revision.',
			'cortext'
		);
	} else if ( isReadOnly || isPostLocked ) {
		restoreReason = __(
			'This document is read-only. Resolve the editing lock before restoring a revision.',
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
			<div className="cortext-revisions-header__tools">
				<Button
					icon={ backup }
					label={ __( 'Revision history', 'cortext' ) }
					isPressed={ activeArea === REVISION_HISTORY_PANEL }
					onClick={ () =>
						enableComplementaryArea(
							INSPECTOR_SCOPE,
							REVISION_HISTORY_PANEL
						)
					}
					size="compact"
				/>
				<Button
					icon={ cog }
					label={ __( 'Revision properties', 'cortext' ) }
					isPressed={ activeArea === DOCUMENT_INSPECTOR }
					onClick={ () =>
						enableComplementaryArea(
							INSPECTOR_SCOPE,
							DOCUMENT_INSPECTOR
						)
					}
					size="compact"
				/>
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
			</div>
			<span className="cortext-revisions-header__label">
				{ revisionLabel( currentRevision ) }
			</span>
			<div className="cortext-revisions-header__actions">
				<Button
					className="cortext-revisions-header__exit"
					variant="secondary"
					onClick={ exitRevisions }
					size="compact"
				>
					{ __( 'Exit', 'cortext' ) }
				</Button>
				<Button
					className="cortext-revisions-header__restore"
					label={ restoreReason }
					showTooltip
					accessibleWhenDisabled
					variant="primary"
					isBusy={ isRestoring }
					disabled={
						isReadOnly ||
						isPostLocked ||
						! canRestore ||
						isRestoring
					}
					onClick={ () => setIsConfirming( true ) }
					size="compact"
				>
					{ __( 'Restore', 'cortext' ) }
				</Button>
			</div>
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
