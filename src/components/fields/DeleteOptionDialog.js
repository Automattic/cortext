import { __, sprintf, _n } from '@wordpress/i18n';
import {
	SelectControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { useEffect, useMemo, useState } from '@wordpress/element';

import './DeleteOptionDialog.scss';

import { useOptionUsage } from '../../hooks/useFieldMutations';

const ACTION_CLEAR = 'clear';
const ACTION_REPLACE = 'replace';

// Lazy-fetches the row count for the option being deleted, then asks the
// user to either clear the value across those rows or replace it with
// another option. When no row uses the value, `onConfirm` fires
// immediately with no migration so the parent can simply drop the option
// without prompting.
export default function DeleteOptionDialog( {
	recordId,
	option,
	remainingOptions,
	onConfirm,
	onCancel,
} ) {
	const usage = useOptionUsage();
	const [ count, setCount ] = useState( null );
	const [ action, setAction ] = useState( ACTION_CLEAR );
	const [ replacement, setReplacement ] = useState(
		remainingOptions[ 0 ]?.value ?? ''
	);
	const [ submitting, setSubmitting ] = useState( false );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		let cancelled = false;
		usage
			.run( recordId, option.value )
			.then( ( next ) => {
				if ( cancelled ) {
					return;
				}
				setCount( next );
				if ( next === 0 ) {
					onConfirm( null );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setError(
						__(
							'Could not check whether rows use this option.',
							'cortext'
						)
					);
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ recordId, option.value ] ); // eslint-disable-line react-hooks/exhaustive-deps

	const replacementChoices = useMemo(
		() =>
			remainingOptions.map( ( o ) => ( {
				value: o.value,
				label: o.label || o.value,
			} ) ),
		[ remainingOptions ]
	);

	if ( error ) {
		return (
			<ConfirmDialog
				onConfirm={ onCancel }
				onCancel={ onCancel }
				confirmButtonText={ __( 'Close', 'cortext' ) }
			>
				<p>{ error }</p>
			</ConfirmDialog>
		);
	}

	if ( count === null || count === 0 ) {
		return null;
	}

	const canReplace = replacementChoices.length > 0;

	const handleConfirm = async () => {
		setSubmitting( true );
		try {
			if ( action === ACTION_REPLACE && canReplace && replacement ) {
				await onConfirm( {
					from: option.value,
					action: ACTION_REPLACE,
					to: replacement,
				} );
			} else {
				await onConfirm( {
					from: option.value,
					action: ACTION_CLEAR,
				} );
			}
		} finally {
			setSubmitting( false );
		}
	};

	return (
		<ConfirmDialog
			onConfirm={ handleConfirm }
			onCancel={ onCancel }
			confirmButtonText={
				submitting
					? __( 'Working…', 'cortext' )
					: __( 'Delete option', 'cortext' )
			}
		>
			<p>
				{ sprintf(
					/* translators: 1: option label, 2: number of rows referencing it */
					_n(
						'%2$d row currently uses "%1$s".',
						'%2$d rows currently use "%1$s".',
						count,
						'cortext'
					),
					option.label || option.value,
					count
				) }
			</p>
			<div className="cortext-delete-option-dialog__choice">
				<label htmlFor="cortext-delete-option-action-clear">
					<input
						id="cortext-delete-option-action-clear"
						type="radio"
						name="cortext-delete-option-action"
						checked={ action === ACTION_CLEAR }
						onChange={ () => setAction( ACTION_CLEAR ) }
					/>
					{ __( 'Clear the value on those rows.', 'cortext' ) }
				</label>
				<label htmlFor="cortext-delete-option-action-replace">
					<input
						id="cortext-delete-option-action-replace"
						type="radio"
						name="cortext-delete-option-action"
						checked={ action === ACTION_REPLACE }
						disabled={ ! canReplace }
						onChange={ () => setAction( ACTION_REPLACE ) }
					/>
					{ __( 'Replace with another option.', 'cortext' ) }
				</label>
				{ action === ACTION_REPLACE && canReplace ? (
					<SelectControl
						__next40pxDefaultSize
						__nextHasNoMarginBottom
						label={ __( 'Replacement', 'cortext' ) }
						value={ replacement }
						options={ replacementChoices }
						onChange={ setReplacement }
					/>
				) : null }
			</div>
		</ConfirmDialog>
	);
}
