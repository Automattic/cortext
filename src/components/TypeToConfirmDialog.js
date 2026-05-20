import { Button, Modal, TextControl } from '@wordpress/components';
import { useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

// A confirm dialog where the destructive button stays disabled until the
// user types the requested phrase (the target's title, typically). Built for
// permanent-delete on collections; reusable for any high-blast-radius action
// that needs a typed acknowledgement, not just a click.
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

	// Focus the input as soon as the modal mounts so the user can start
	// typing the confirmation phrase without an extra click. TextControl
	// wraps its input, so reach in for the actual <input> element.
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
