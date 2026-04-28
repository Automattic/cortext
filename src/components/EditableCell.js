import { __ } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	DateTimePicker,
	Dropdown,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalNumberControl as NumberControl,
	SelectControl,
	TextControl,
} from '@wordpress/components';
import {
	createContext,
	useContext,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';

import MultiselectEdit from './MultiselectEdit';

export const RowMutationContext = createContext( {
	saveRowField: null,
	autoFocusRowId: null,
	clearAutoFocus: () => {},
} );

const TEXT_INPUT_TYPES = new Set( [ 'text', 'email', 'url', 'number' ] );

function formatDisplay( value, type, elements ) {
	if ( value === null || value === undefined || value === '' ) {
		return '';
	}

	if ( type === 'checkbox' ) {
		return value ? __( 'Yes', 'cortext' ) : __( 'No', 'cortext' );
	}

	if ( type === 'select' || type === 'multiselect' ) {
		const list = Array.isArray( value ) ? value : [ value ];
		const labelFor = ( v ) =>
			elements?.find( ( e ) => e.value === v )?.label ?? v;
		return list.map( labelFor ).filter( Boolean ).join( ', ' );
	}

	if ( type === 'date' || type === 'datetime' ) {
		const date = new Date( value );
		if ( Number.isNaN( date.getTime() ) ) {
			return String( value );
		}
		return type === 'date'
			? date.toLocaleDateString()
			: date.toLocaleString();
	}

	return String( value );
}

function CellShell( { children, onActivate, ariaLabel, isEmpty } ) {
	return (
		<div
			role="button"
			tabIndex={ 0 }
			className={
				'cortext-editable-cell' +
				( isEmpty ? ' cortext-editable-cell--empty' : '' )
			}
			onClick={ onActivate }
			onKeyDown={ ( event ) => {
				if ( event.key === 'Enter' || event.key === ' ' ) {
					event.preventDefault();
					onActivate();
				}
			} }
			aria-label={ ariaLabel }
		>
			{ children }
		</div>
	);
}

function toCommittedNumber( raw ) {
	if ( raw === '' || raw === null || raw === undefined ) {
		return null;
	}
	return Number( raw );
}

function inputTypeFor( type ) {
	if ( type === 'email' ) {
		return 'email';
	}
	if ( type === 'url' ) {
		return 'url';
	}
	return 'text';
}

function TextLikeEditor( {
	value,
	type,
	onCommit,
	onCancel,
	shouldAutoFocus,
	label,
} ) {
	const [ local, setLocal ] = useState( value ?? '' );
	const inputRef = useRef( null );

	useEffect( () => {
		if ( shouldAutoFocus && inputRef.current ) {
			inputRef.current.focus?.();
			inputRef.current.select?.();
		}
	}, [ shouldAutoFocus ] );

	const commit = () => {
		const next = type === 'number' ? toCommittedNumber( local ) : local;
		onCommit( next );
	};

	const handleKeyDown = ( event ) => {
		if ( event.key === 'Enter' ) {
			event.preventDefault();
			commit();
		} else if ( event.key === 'Escape' ) {
			event.preventDefault();
			onCancel();
		}
	};

	if ( type === 'number' ) {
		return (
			<NumberControl
				ref={ inputRef }
				value={ local ?? '' }
				onChange={ ( next ) => setLocal( next ?? '' ) }
				onBlur={ commit }
				onKeyDown={ handleKeyDown }
				label={ label }
				hideLabelFromVision
				__next40pxDefaultSize
			/>
		);
	}

	return (
		<TextControl
			ref={ inputRef }
			value={ local ?? '' }
			onChange={ setLocal }
			onBlur={ commit }
			onKeyDown={ handleKeyDown }
			type={ inputTypeFor( type ) }
			label={ label }
			hideLabelFromVision
			__next40pxDefaultSize
			__nextHasNoMarginBottom
		/>
	);
}

function SelectEditor( { value, elements, onCommit, onCancel, label } ) {
	const ref = useRef( null );
	useEffect( () => {
		ref.current?.focus?.();
	}, [] );
	const options = [
		{ value: '', label: __( '— Select —', 'cortext' ) },
		...( elements ?? [] ),
	];
	return (
		<SelectControl
			ref={ ref }
			value={ value ?? '' }
			options={ options }
			onChange={ ( next ) => onCommit( next === '' ? null : next ) }
			onBlur={ onCancel }
			label={ label }
			hideLabelFromVision
			__next40pxDefaultSize
			__nextHasNoMarginBottom
		/>
	);
}

function DateEditor( { value, type, onCommit, onCancel, label } ) {
	return (
		<Dropdown
			defaultOpen
			onClose={ onCancel }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					variant="tertiary"
					onClick={ onToggle }
					aria-expanded={ isOpen }
				>
					{ value
						? formatDisplay( value, type )
						: __( 'Pick a date…', 'cortext' ) }
				</Button>
			) }
			renderContent={ ( { onClose } ) => (
				<div className="cortext-editable-cell__date">
					<DateTimePicker
						currentDate={ value || null }
						onChange={ ( next ) => {
							onCommit( next );
							onClose();
						} }
						is12Hour
						aria-label={ label }
					/>
				</div>
			) }
		/>
	);
}

export default function EditableCell( {
	item,
	fieldId,
	fieldType,
	elements,
	label,
	getValue,
	readOnly = false,
} ) {
	const { saveRowField, autoFocusRowId, clearAutoFocus } =
		useContext( RowMutationContext );
	const [ isEditing, setIsEditing ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const rowId = item?.id;
	const value = getValue
		? getValue( { item } )
		: item?.meta?.[ fieldId ] ?? null;
	const display = formatDisplay( value, fieldType, elements );

	// Auto-open the title cell of a freshly created row, exactly once.
	useEffect( () => {
		if (
			fieldId === 'title' &&
			rowId &&
			autoFocusRowId === rowId &&
			! isEditing &&
			! readOnly &&
			saveRowField
		) {
			setIsEditing( true );
			clearAutoFocus?.();
		}
	}, [
		fieldId,
		rowId,
		autoFocusRowId,
		isEditing,
		readOnly,
		saveRowField,
		clearAutoFocus,
	] );

	if ( readOnly || ! saveRowField ) {
		return <span className="cortext-cell-readonly">{ display }</span>;
	}

	const closeEditor = () => {
		setIsEditing( false );
		setIsSaving( false );
		setError( null );
	};

	const commit = async ( next ) => {
		// Skip the round-trip when nothing changed.
		const equal = Array.isArray( next )
			? Array.isArray( value ) &&
			  next.length === value.length &&
			  next.every( ( v, i ) => v === value[ i ] )
			: next === value ||
			  ( next === '' && ( value === null || value === undefined ) );
		if ( equal ) {
			closeEditor();
			return;
		}
		setIsSaving( true );
		setError( null );
		try {
			await saveRowField( rowId, fieldId, next );
			closeEditor();
		} catch ( err ) {
			setError( err?.message ?? __( 'Could not save.', 'cortext' ) );
			setIsSaving( false );
		}
	};

	// Checkbox: direct toggle, no click-to-edit step.
	if ( fieldType === 'checkbox' ) {
		return (
			<CheckboxControl
				checked={ Boolean( value ) }
				onChange={ ( next ) => commit( next ) }
				disabled={ isSaving }
				label={ label }
				hideLabelFromVision
				__nextHasNoMarginBottom
			/>
		);
	}

	if ( ! isEditing ) {
		return (
			<CellShell
				ariaLabel={ label }
				isEmpty={ display === '' }
				onActivate={ () => setIsEditing( true ) }
			>
				{ display || (
					<span className="cortext-editable-cell__placeholder">
						{ __( 'Empty', 'cortext' ) }
					</span>
				) }
			</CellShell>
		);
	}

	let editor = null;
	if ( fieldType === 'multiselect' ) {
		editor = (
			<MultiselectEdit
				value={ Array.isArray( value ) ? value : [] }
				elements={ elements ?? [] }
				onCommit={ commit }
				onCancel={ closeEditor }
				label={ label }
			/>
		);
	} else if ( fieldType === 'select' ) {
		editor = (
			<SelectEditor
				value={ value }
				elements={ elements }
				onCommit={ commit }
				onCancel={ closeEditor }
				label={ label }
			/>
		);
	} else if ( fieldType === 'date' || fieldType === 'datetime' ) {
		editor = (
			<DateEditor
				value={ value }
				type={ fieldType }
				onCommit={ commit }
				onCancel={ closeEditor }
				label={ label }
			/>
		);
	} else if ( TEXT_INPUT_TYPES.has( fieldType ) || fieldType === 'title' ) {
		editor = (
			<TextLikeEditor
				value={ value ?? '' }
				type={ fieldType === 'title' ? 'text' : fieldType }
				onCommit={ commit }
				onCancel={ closeEditor }
				shouldAutoFocus
				label={ label }
			/>
		);
	} else {
		// Unknown/unsupported types: fall back to display-only.
		editor = <span className="cortext-cell-readonly">{ display }</span>;
	}

	return (
		<div className="cortext-editable-cell cortext-editable-cell--editing">
			{ editor }
			{ error ? (
				<div className="cortext-editable-cell__error" role="alert">
					{ error }
				</div>
			) : null }
		</div>
	);
}
