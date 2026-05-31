import { Button, Modal, Notice } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

export function PostLockFailureNotice( { error, isRetrying, onRetry } ) {
	if ( ! error ) {
		return null;
	}

	return (
		<Notice
			className="cortext-canvas__notice"
			status="warning"
			isDismissible={ false }
			actions={ [
				{
					label: __( 'Retry', 'cortext' ),
					onClick: onRetry,
					disabled: isRetrying,
					variant: 'primary',
				},
			] }
		>
			{ error }
		</Notice>
	);
}

export function PostLockModal( {
	isOpen,
	isTakeover,
	isTakingOver,
	onTakeOver,
	user,
} ) {
	if ( ! isOpen ) {
		return null;
	}

	const userName = user?.name || __( 'Someone', 'cortext' );
	const userAvatar = user?.avatar;

	return (
		<Modal
			title={
				isTakeover
					? __(
							'Someone else is editing this document now',
							'cortext'
					  )
					: __( 'This document is already being edited', 'cortext' )
			}
			focusOnMount
			shouldCloseOnClickOutside={ false }
			shouldCloseOnEsc={ false }
			isDismissible={ false }
			className="editor-post-locked-modal"
			size="medium"
		>
			<div className="cortext-post-lock-modal__content">
				{ userAvatar ? (
					<img
						src={ userAvatar }
						alt={ sprintf(
							/* translators: %s: user display name */
							__( 'Avatar for %s', 'cortext' ),
							userName
						) }
						className="editor-post-locked-modal__avatar"
						width={ 64 }
						height={ 64 }
					/>
				) : null }
				<div>
					<p>
						{ isTakeover
							? sprintf(
									/* translators: %s: user display name */
									__(
										'%s is editing this document now. You can keep viewing it, or take over to make changes.',
										'cortext'
									),
									userName
							  )
							: sprintf(
									/* translators: %s: user display name */
									__(
										'%s is editing this document right now. To make changes, take over from them.',
										'cortext'
									),
									userName
							  ) }
					</p>
					<p>
						{ __(
							'Taking over lets you edit here in Cortext. The other user will switch to read-only.',
							'cortext'
						) }
					</p>
					<div className="editor-post-locked-modal__buttons">
						<Button
							__next40pxDefaultSize
							variant="primary"
							isBusy={ isTakingOver }
							disabled={ isTakingOver }
							onClick={ onTakeOver }
						>
							{ __( 'Take over', 'cortext' ) }
						</Button>
					</div>
				</div>
			</div>
		</Modal>
	);
}
