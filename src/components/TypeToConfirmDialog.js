import { Button, Modal, TextControl } from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

// Confirmation dialog for destructive actions that need a typed
// acknowledgement, usually the target's title.
export default function TypeToConfirmDialog( {
	title,
	message,
	confirmPhrase,
	confirmLabel = __( 'Delete permanently', 'cortext' ),
	cancelLabel = __( 'Cancel', 'cortext' ),
	onConfirm,
	onCancel,
	isBusy = false,
} ) {
	const [ value, setValue ] = useState( '' );
	const inputWrapperRef = useRef( null );

	// Put the cursor in the field on mount so the user can start typing.
	// TextControl wraps the actual input, so reach into the wrapper.
	useEffect( () => {
		const input = inputWrapperRef.current?.querySelector( 'input' );
		input?.focus();
	}, [] );

	const matches = value.trim() === confirmPhrase.trim();
	const submit = () => {
		if ( ! matches || isBusy ) {
			return;
		}
		onConfirm();
	};

	return (
		<Modal
			className="cortext-type-to-confirm"
			title={ title }
			onRequestClose={ () => {
				if ( ! isBusy ) {
					onCancel();
				}
			} }
			size="small"
		>
			<p>{ message }</p>
			<div ref={ inputWrapperRef }>
				<TextControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ confirmPhrase }
					hideLabelFromVision
					placeholder={ confirmPhrase }
					value={ value }
					onChange={ setValue }
					onKeyDown={ ( event ) => {
						if ( event.key === 'Enter' && matches && ! isBusy ) {
							event.preventDefault();
							submit();
						} else if ( event.key === 'Escape' && ! isBusy ) {
							event.preventDefault();
							onCancel();
						}
					} }
					disabled={ isBusy }
				/>
			</div>
			<div className="cortext-type-to-confirm__actions">
				<Button
					variant="tertiary"
					onClick={ onCancel }
					disabled={ isBusy }
				>
					{ cancelLabel }
				</Button>
				<Button
					variant="primary"
					isDestructive
					onClick={ submit }
					disabled={ ! matches || isBusy }
					isBusy={ isBusy }
				>
					{ confirmLabel }
				</Button>
			</div>
		</Modal>
	);
}
