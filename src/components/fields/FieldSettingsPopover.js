import { __ } from '@wordpress/i18n';
import {
	Button,
	DateTimePicker,
	Dropdown,
	Notice,
	Popover,
	TextControl,
	TextareaControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalNumberControl as NumberControl,
} from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';

import './FieldSettingsPopover.scss';

import EditOptionsPopover from './EditOptionsPopover';
import {
	DEFAULT_SUPPORTED_TYPES,
	encodeDefaultConfig,
} from '../../hooks/fieldDefaults';
import { elementsFromOptions } from '../../hooks/optionElements';
import { useMappedField } from '../CollectionFieldsContext';
import { dateOnlyValue, formatDisplay } from '../EditableCell';

function fieldDefaultInitialValue( config, type ) {
	if ( ! config ) {
		return type === 'multiselect' ? [] : '';
	}
	if ( config.mode === 'today' ) {
		return '';
	}
	if ( type === 'multiselect' ) {
		return Array.isArray( config.value ) ? config.value : [];
	}
	return config.value ?? '';
}

function defaultModeFor( config, type ) {
	if ( ! config ) {
		return 'none';
	}
	if (
		config.mode === 'today' &&
		( type === 'date' || type === 'datetime' )
	) {
		return 'today';
	}
	return 'value';
}

function optionValues( elements ) {
	return Array.isArray( elements )
		? elements.map( ( option ) => option.value ).filter( Boolean )
		: [];
}

function buildDefaultConfig( type, mode, value, elements ) {
	if ( mode === 'none' ) {
		return null;
	}
	if ( mode === 'today' ) {
		return { mode: 'today' };
	}

	if ( type === 'checkbox' ) {
		return { mode: 'value', value: Boolean( value ) };
	}
	if ( type === 'select' ) {
		const selected = String( value ?? '' ).trim();
		return selected && optionValues( elements ).includes( selected )
			? { mode: 'value', value: selected }
			: null;
	}
	if ( type === 'multiselect' ) {
		const values = optionValues( elements );
		const selected = ( Array.isArray( value ) ? value : [] ).filter(
			( optionValue, index, list ) =>
				optionValue &&
				values.includes( optionValue ) &&
				list.indexOf( optionValue ) === index
		);
		return selected.length > 0 ? { mode: 'value', value: selected } : null;
	}
	if ( type === 'number' ) {
		const next = Number( value );
		return Number.isFinite( next ) ? { mode: 'value', value: next } : null;
	}

	const text = String( value ?? '' ).trim();
	return text ? { mode: 'value', value: text } : null;
}

function reconcileOptionDefault( type, current, elements, migration ) {
	const values = optionValues( elements );
	if ( type === 'select' ) {
		let next = current ?? '';
		if ( migration?.from === next ) {
			next = migration.action === 'replace' ? migration.to ?? '' : '';
		}
		return next && values.includes( next )
			? { mode: 'value', value: next }
			: { mode: 'none', value: '' };
	}

	const selected = Array.isArray( current ) ? current : [];
	const migrated = selected.map( ( optionValue ) => {
		if ( migration?.from !== optionValue ) {
			return optionValue;
		}
		return migration.action === 'replace' ? migration.to ?? '' : '';
	} );
	const next = migrated.filter(
		( optionValue, index, list ) =>
			optionValue &&
			values.includes( optionValue ) &&
			list.indexOf( optionValue ) === index
	);
	return next.length
		? { mode: 'value', value: next }
		: { mode: 'none', value: [] };
}

function DefaultModeButtons( { label, options, value, onChange } ) {
	return (
		<fieldset className="cortext-field-settings-popover__fieldset">
			<legend>{ label }</legend>
			<div className="cortext-field-settings-popover__segmented">
				{ options.map( ( option ) => (
					<Button
						key={ option.value }
						variant="tertiary"
						isPressed={ value === option.value }
						onClick={ () => onChange( option.value ) }
					>
						{ option.label }
					</Button>
				) ) }
			</div>
		</fieldset>
	);
}

function DefaultPlaceholder() {
	return (
		<span className="cortext-field-settings-popover__empty-value">
			{ __( 'No default', 'cortext' ) }
		</span>
	);
}

function displayDefaultValue( value, type, options = {} ) {
	const display = formatDisplay( value, type, options );
	return display === '' ? <DefaultPlaceholder /> : display;
}

function DefaultSectionHeader( { isEmpty, onClear } ) {
	return (
		<div className="cortext-field-settings-popover__control-heading">
			<div className="cortext-field-settings-popover__label">
				{ __( 'Default', 'cortext' ) }
			</div>
			<Button
				className="cortext-field-settings-popover__clear-default"
				variant="tertiary"
				isPressed={ isEmpty }
				onClick={ onClear }
			>
				{ __( 'No default', 'cortext' ) }
			</Button>
		</div>
	);
}

function ScalarDefaultControl( {
	type,
	mode,
	value,
	onDefaultChange,
	onDefaultCommit,
} ) {
	const isNumber = type === 'number';
	const clear = () => {
		onDefaultCommit( 'none', '' );
	};
	const onChange = ( next ) => {
		if ( next === '' || next === null || next === undefined ) {
			onDefaultChange( 'none', '' );
			return;
		}
		onDefaultChange( 'value', next );
	};
	const label = __( 'Default value', 'cortext' );
	const controlProps = {
		label,
		hideLabelFromVision: true,
		value: mode === 'value' ? value : '',
		onChange,
		onBlur: () => onDefaultCommit( mode, value ),
		__next40pxDefaultSize: true,
	};

	return (
		<div className="cortext-field-settings-popover__scalar-default">
			<DefaultSectionHeader
				isEmpty={ mode !== 'value' }
				onClear={ clear }
			/>
			{ isNumber ? (
				<NumberControl { ...controlProps } />
			) : (
				<TextControl
					{ ...controlProps }
					type={ type === 'text' ? undefined : type }
					__nextHasNoMarginBottom
				/>
			) }
		</div>
	);
}

function DateDefaultControl( {
	field,
	type,
	mode,
	value,
	onDefaultChange,
	onDefaultCommit,
} ) {
	const isDatetime = type === 'datetime';
	const modeValue = mode === 'value' ? value : '';
	return (
		<>
			<DefaultModeButtons
				label={ __( 'Default', 'cortext' ) }
				value={ mode }
				options={ [
					{ value: 'none', label: __( 'No default', 'cortext' ) },
					{ value: 'today', label: __( 'Today', 'cortext' ) },
					{
						value: 'value',
						label: isDatetime
							? __( 'Date and time', 'cortext' )
							: __( 'Date', 'cortext' ),
					},
				] }
				onChange={ ( nextMode ) => {
					if ( nextMode === 'value' ) {
						onDefaultChange( nextMode, value );
						return;
					}
					onDefaultCommit( nextMode, '' );
				} }
			/>
			{ mode === 'value' ? (
				<Dropdown
					popoverProps={ { placement: 'bottom-start' } }
					renderToggle={ ( { isOpen, onToggle } ) => (
						<Button
							className="cortext-field-settings-popover__value-trigger cortext-date-edit__toggle"
							variant="tertiary"
							onClick={ onToggle }
							aria-expanded={ isOpen }
							label={
								isDatetime
									? __( 'Default date and time', 'cortext' )
									: __( 'Default date', 'cortext' )
							}
						>
							{ modeValue
								? displayDefaultValue( modeValue, type, {
										format: field.cortextFormat,
								  } )
								: __( 'Pick a date…', 'cortext' ) }
						</Button>
					) }
					renderContent={ () => (
						<div className="cortext-field-settings-popover__date-picker">
							<DateTimePicker
								currentDate={ modeValue || null }
								onChange={ ( next ) => {
									onDefaultCommit(
										'value',
										type === 'date'
											? dateOnlyValue( next )
											: next
									);
								} }
								is12Hour={ field.cortextFormat?.hour12 ?? true }
								aria-label={
									isDatetime
										? __(
												'Default date and time',
												'cortext'
										  )
										: __( 'Default date', 'cortext' )
								}
							/>
						</div>
					) }
				/>
			) : null }
		</>
	);
}

function CheckboxDefaultControl( { mode, value, onDefaultCommit } ) {
	let selected = 'none';
	if ( mode === 'value' ) {
		selected = value ? 'checked' : 'unchecked';
	}

	return (
		<DefaultModeButtons
			label={ __( 'Default', 'cortext' ) }
			value={ selected }
			options={ [
				{ value: 'none', label: __( 'No default', 'cortext' ) },
				{ value: 'checked', label: __( 'Checked', 'cortext' ) },
				{ value: 'unchecked', label: __( 'Unchecked', 'cortext' ) },
			] }
			onChange={ ( next ) => {
				onDefaultCommit(
					next === 'none' ? 'none' : 'value',
					next === 'checked'
				);
			} }
		/>
	);
}

function OptionsDefaultControl( {
	field,
	type,
	mode,
	value,
	elements,
	onDefaultCommit,
	onOptionsSaved,
	onRowsChanged,
} ) {
	let selected = null;
	if ( type === 'multiselect' ) {
		selected = mode === 'value' && Array.isArray( value ) ? value : [];
	} else if ( mode === 'value' ) {
		selected = value;
	}
	const recordId = field.cortextRecordId ?? field.recordId;

	const pick = ( optionValue ) => {
		if ( type === 'select' ) {
			if ( ! optionValue ) {
				onDefaultCommit( 'none', '' );
				return;
			}
			onDefaultCommit( 'value', optionValue );
			return;
		}

		const current = Array.isArray( selected ) ? selected : [];
		const next = current.includes( optionValue )
			? current.filter( ( item ) => item !== optionValue )
			: [ ...current, optionValue ];
		onDefaultCommit( next.length ? 'value' : 'none', next );
	};

	return (
		<div className="cortext-field-settings-popover__options-default">
			<DefaultSectionHeader
				isEmpty={ mode !== 'value' }
				onClear={ () =>
					onDefaultCommit( 'none', type === 'multiselect' ? [] : '' )
				}
			/>
			<EditOptionsPopover
				recordId={ recordId }
				fieldType={ type }
				initialOptions={ elements }
				value={ selected }
				onOptionsSaved={ onOptionsSaved }
				onRowsChanged={ onRowsChanged }
				onPick={ pick }
			/>
		</div>
	);
}

function DefaultControl( {
	field,
	mode,
	value,
	elements,
	onDefaultChange,
	onDefaultCommit,
	onOptionsSaved,
	onRowsChanged,
} ) {
	const type = field?.cortextType;

	if ( ! DEFAULT_SUPPORTED_TYPES.has( type ) ) {
		return null;
	}

	if ( type === 'checkbox' ) {
		return (
			<CheckboxDefaultControl
				mode={ mode }
				value={ value }
				onDefaultCommit={ onDefaultCommit }
			/>
		);
	}

	if ( type === 'select' || type === 'multiselect' ) {
		return (
			<OptionsDefaultControl
				field={ field }
				type={ type }
				mode={ mode }
				elements={ elements }
				value={ mode === 'value' ? value : [] }
				onDefaultCommit={ onDefaultCommit }
				onOptionsSaved={ onOptionsSaved }
				onRowsChanged={ onRowsChanged }
			/>
		);
	}

	if ( type === 'date' || type === 'datetime' ) {
		return (
			<DateDefaultControl
				field={ field }
				type={ type }
				mode={ mode }
				value={ value }
				onDefaultChange={ onDefaultChange }
				onDefaultCommit={ onDefaultCommit }
			/>
		);
	}

	return (
		<ScalarDefaultControl
			type={ type }
			mode={ mode }
			value={ value }
			onDefaultChange={ onDefaultChange }
			onDefaultCommit={ onDefaultCommit }
		/>
	);
}

export default function FieldSettingsPopover( {
	recordId,
	anchor,
	onClose,
	onFieldOptionsSaved,
	onRowsChanged,
} ) {
	const field = useMappedField( recordId );
	const { saveEntityRecord } = useDispatch( 'core' );
	const [ description, setDescription ] = useState( '' );
	const [ savedDescription, setSavedDescription ] = useState( '' );
	const [ defaultMode, setDefaultMode ] = useState( 'none' );
	const [ defaultValue, setDefaultValue ] = useState( '' );
	const [ localElements, setLocalElements ] = useState( [] );
	const initializedKeyRef = useRef( null );
	const localElementsRef = useRef( [] );
	const [ savedDefault, setSavedDefault ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const type = field?.cortextType;
	const supportsDefault = DEFAULT_SUPPORTED_TYPES.has( type );

	useEffect( () => {
		if ( ! field ) {
			return;
		}
		const initKey = `${ recordId }:${ type }`;
		if ( initializedKeyRef.current === initKey ) {
			return;
		}
		initializedKeyRef.current = initKey;
		const initialDescription = field.description ?? '';
		const initialDefault = encodeDefaultConfig(
			field.cortextDefaultConfig
		);
		const initialElements = field.cortextElements ?? [];
		setDescription( initialDescription );
		setSavedDescription( initialDescription );
		setDefaultMode( defaultModeFor( field.cortextDefaultConfig, type ) );
		setDefaultValue(
			fieldDefaultInitialValue( field.cortextDefaultConfig, type )
		);
		setLocalElements( initialElements );
		localElementsRef.current = initialElements;
		setSavedDefault( initialDefault );
		setError( null );
	}, [ field, recordId, type ] );

	const persistMeta = useCallback(
		async ( meta ) => {
			setIsSaving( true );
			setError( null );
			try {
				const saved = await saveEntityRecord(
					'postType',
					'crtxt_field',
					{
						id: recordId,
						meta,
					}
				);
				if ( ! saved ) {
					throw new Error( 'cortext_field_settings_failed' );
				}
				return true;
			} catch ( apiError ) {
				setError(
					apiError?.message ||
						__( 'Could not save field settings.', 'cortext' )
				);
				return false;
			} finally {
				setIsSaving( false );
			}
		},
		[ recordId, saveEntityRecord ]
	);

	const persistDescription = useCallback( async () => {
		const next = description.trim();
		if ( next !== description ) {
			setDescription( next );
		}
		if ( next === savedDescription ) {
			return;
		}
		if ( await persistMeta( { description: next } ) ) {
			setSavedDescription( next );
		}
	}, [ description, persistMeta, savedDescription ] );

	const setDraftDefault = useCallback( ( nextMode, nextValue ) => {
		setDefaultMode( nextMode );
		setDefaultValue( nextValue );
	}, [] );

	const persistDefault = useCallback(
		async ( nextMode, nextValue, elements = localElementsRef.current ) => {
			setDraftDefault( nextMode, nextValue );
			if ( ! supportsDefault ) {
				return;
			}
			const encoded = encodeDefaultConfig(
				buildDefaultConfig( type, nextMode, nextValue, elements )
			);
			if ( encoded === savedDefault ) {
				return;
			}
			if ( await persistMeta( { default_value: encoded } ) ) {
				setSavedDefault( encoded );
			}
		},
		[ persistMeta, savedDefault, setDraftDefault, supportsDefault, type ]
	);

	const handleOptionsSaved = useCallback(
		( nextOptions, migration ) => {
			const nextElements = elementsFromOptions( nextOptions ) ?? [];
			setLocalElements( nextElements );
			localElementsRef.current = nextElements;
			onFieldOptionsSaved?.( recordId, nextOptions );
			if (
				defaultMode === 'value' &&
				( type === 'select' || type === 'multiselect' )
			) {
				const reconciled = reconcileOptionDefault(
					type,
					defaultValue,
					nextElements,
					migration
				);
				setDefaultMode( reconciled.mode );
				setDefaultValue( reconciled.value );
				setSavedDefault(
					encodeDefaultConfig(
						buildDefaultConfig(
							type,
							reconciled.mode,
							reconciled.value,
							nextElements
						)
					)
				);
			}
		},
		[ defaultMode, defaultValue, onFieldOptionsSaved, recordId, type ]
	);

	if ( ! field ) {
		return null;
	}

	return (
		<Popover
			anchor={ anchor }
			placement="bottom-start"
			onClose={ onClose }
			focusOnMount="firstElement"
			className="cortext-field-settings-popover"
		>
			<div className="cortext-field-settings-popover__panel">
				{ error ? (
					<Notice status="error" isDismissible={ false }>
						{ error }
					</Notice>
				) : null }
				<TextareaControl
					label={ __( 'Description', 'cortext' ) }
					value={ description }
					onChange={ setDescription }
					onBlur={ persistDescription }
					rows={ 3 }
					__nextHasNoMarginBottom
				/>
				{ supportsDefault ? (
					<DefaultControl
						field={ field }
						mode={ defaultMode }
						value={ defaultValue }
						elements={ localElements }
						onDefaultChange={ setDraftDefault }
						onDefaultCommit={ persistDefault }
						onOptionsSaved={ handleOptionsSaved }
						onRowsChanged={ onRowsChanged }
					/>
				) : null }
				{ isSaving ? (
					<div className="cortext-field-settings-popover__saving">
						{ __( 'Saving…', 'cortext' ) }
					</div>
				) : null }
			</div>
		</Popover>
	);
}
