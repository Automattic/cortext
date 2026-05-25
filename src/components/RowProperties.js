/**
 * Property panel for a row document. Renders one row per collection field
 * with the right edit affordance for that field type. Mounted by row detail
 * chrome and full-page row chrome for now; see tech-debt.md#41 for the
 * follow-up that turns this into a locked document block.
 *
 * Reads the post's edited title and meta from `editorStore` so the live
 * values stay in sync with the locked `core/post-title` block above and
 * any field changes that flow through autosave.
 */

import {
	Button,
	CheckboxControl,
	DateTimePicker,
	Dropdown,
	Popover,
} from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import {
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';

import {
	RowMutationContext,
	dateOnlyValue,
	formatDisplay,
} from './EditableCell';
import { TITLE_FIELD_ID } from './dataViewColumns';
import EditOptionsPopover from './fields/EditOptionsPopover';
import { FieldTypeIcon, SystemFieldIcon } from './fields/fieldTypes';
import { hasSystemFieldIcon } from './fields/systemFieldIconIds';
import { toRecordId } from '../hooks/fieldIds';
import {
	isRowDetailFieldEditable,
	isValidNumberDraft,
	parseNumberPropertyValue,
	rowDetailFieldType as fieldType,
	splitPropertyPatch,
	valueForField,
} from './rowDetailUtils';

function emptyLabel() {
	return (
		<span className="cortext-row-detail__empty-value">
			{ __( 'Empty', 'cortext' ) }
		</span>
	);
}

function ReadOnlyProperty( { value, type, elements, format } ) {
	const display = formatDisplay( value, type, { elements, format } );
	return (
		<div className="cortext-row-detail__readonly">
			{ display === '' ? emptyLabel() : display }
		</div>
	);
}

function OptionPropertyValue( { value, type, elements } ) {
	const display = formatDisplay( value, type, { elements } );
	return display === '' ? emptyLabel() : display;
}

function isCollectionField( field ) {
	return (
		field?.id?.startsWith?.( 'field-' ) &&
		Boolean( field.cortextRecordId ?? field.recordId )
	);
}

function hasInternalFieldIcon( field ) {
	return hasSystemFieldIcon( field?.id );
}

function SelectPropertyControl( {
	field,
	value,
	elements,
	onChange,
	onOptionsSaved,
	onRowsChanged,
} ) {
	const [ anchor, setAnchor ] = useState( null );
	const [ isOpen, setIsOpen ] = useState( false );
	const close = useCallback( () => setIsOpen( false ), [] );
	const recordId = field.cortextRecordId ?? toRecordId( field.id );

	return (
		<>
			<Button
				ref={ setAnchor }
				className="cortext-row-detail__property-trigger"
				variant="tertiary"
				onClick={ () => setIsOpen( true ) }
				aria-expanded={ isOpen }
				aria-label={ field.label }
			>
				<OptionPropertyValue
					value={ value }
					type="select"
					elements={ elements }
				/>
			</Button>
			{ isOpen && anchor ? (
				<Popover
					anchor={ anchor }
					placement="bottom-start"
					onClose={ close }
					focusOnMount="firstElement"
				>
					<EditOptionsPopover
						recordId={ recordId }
						fieldType="select"
						initialOptions={ elements ?? [] }
						value={ value }
						onOptionsSaved={ onOptionsSaved }
						onRowsChanged={ onRowsChanged }
						onRequestClose={ close }
						onPick={ async ( next ) => {
							onChange( next );
							close();
						} }
					/>
				</Popover>
			) : null }
		</>
	);
}

function MultiselectPropertyControl( {
	field,
	value,
	elements,
	onChange,
	onOptionsSaved,
	onRowsChanged,
} ) {
	const [ anchor, setAnchor ] = useState( null );
	const [ isOpen, setIsOpen ] = useState( false );
	const close = useCallback( () => setIsOpen( false ), [] );
	const recordId = field.cortextRecordId ?? toRecordId( field.id );
	const current = useMemo(
		() => ( Array.isArray( value ) ? value : [] ),
		[ value ]
	);
	const handlePick = useCallback(
		( optionValue ) => {
			const next = current.includes( optionValue )
				? current.filter( ( item ) => item !== optionValue )
				: [ ...current, optionValue ];
			onChange( next );
		},
		[ current, onChange ]
	);

	return (
		<>
			<Button
				ref={ setAnchor }
				className="cortext-row-detail__property-trigger"
				variant="tertiary"
				onClick={ () => setIsOpen( true ) }
				aria-expanded={ isOpen }
				aria-label={ field.label }
			>
				<OptionPropertyValue
					value={ current }
					type="multiselect"
					elements={ elements }
				/>
			</Button>
			{ isOpen && anchor ? (
				<Popover
					anchor={ anchor }
					placement="bottom-start"
					onClose={ close }
					focusOnMount="firstElement"
				>
					<EditOptionsPopover
						recordId={ recordId }
						fieldType="multiselect"
						initialOptions={ elements ?? [] }
						value={ current }
						onOptionsSaved={ onOptionsSaved }
						onRowsChanged={ onRowsChanged }
						onRequestClose={ close }
						onPick={ handlePick }
					/>
				</Popover>
			) : null }
		</>
	);
}

function DatePropertyControl( { field, value, type, onChange } ) {
	const display = value
		? formatDisplay( value, type, { format: field.cortextFormat } )
		: __( 'Empty', 'cortext' );

	return (
		<Dropdown
			popoverProps={ { placement: 'bottom-start' } }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					className="cortext-row-detail__property-trigger"
					variant="tertiary"
					onClick={ onToggle }
					aria-expanded={ isOpen }
					aria-label={ field.label }
				>
					{ display }
				</Button>
			) }
			renderContent={ () => (
				<div className="cortext-row-detail__date-popover">
					<DateTimePicker
						currentDate={ value || null }
						onChange={ ( next ) =>
							onChange(
								type === 'date' ? dateOnlyValue( next ) : next
							)
						}
						is12Hour={ field.cortextFormat?.hour12 ?? true }
						aria-label={ field.label }
					/>
				</div>
			) }
		/>
	);
}

function EditablePropertyText( { label, inputMode, value, onChange } ) {
	const textValue =
		value === null || value === undefined ? '' : String( value );
	const [ draft, setDraft ] = useState( textValue );
	const [ isFocused, setIsFocused ] = useState( false );

	useEffect( () => {
		if ( ! isFocused ) {
			setDraft( textValue );
		}
	}, [ isFocused, textValue ] );

	return (
		<input
			aria-label={ label }
			className="cortext-row-detail__property-editable-text"
			inputMode={ inputMode }
			placeholder={ isFocused ? '' : __( 'Empty', 'cortext' ) }
			type="text"
			value={ draft }
			onBlur={ () => setIsFocused( false ) }
			onChange={ ( event ) => {
				const next = event.currentTarget.value;
				setDraft( next );
				onChange( next );
			} }
			onFocus={ () => setIsFocused( true ) }
		/>
	);
}

function EditableNumberPropertyText( { label, value, onChange } ) {
	const textValue =
		value === null || value === undefined ? '' : String( value );
	const committedTextRef = useRef( textValue );
	const committedValueRef = useRef( value ?? null );
	const [ draft, setDraft ] = useState( textValue );
	const [ isFocused, setIsFocused ] = useState( false );

	useEffect( () => {
		committedTextRef.current = textValue;
		committedValueRef.current = value ?? null;

		if ( ! isFocused ) {
			setDraft( textValue );
		}
	}, [ isFocused, textValue, value ] );

	const commitDraft = useCallback(
		( nextDraft ) => {
			if ( ! isValidNumberDraft( nextDraft ) ) {
				return;
			}

			setDraft( nextDraft );
			const parsed = parseNumberPropertyValue( nextDraft );

			if ( parsed.complete ) {
				const normalized =
					parsed.value === null ? '' : String( parsed.value );
				if ( ! Object.is( parsed.value, committedValueRef.current ) ) {
					onChange( parsed.value );
				}
				committedValueRef.current = parsed.value;
				committedTextRef.current = normalized;
			}
		},
		[ onChange ]
	);

	return (
		<input
			aria-label={ label }
			className="cortext-row-detail__property-editable-text"
			inputMode="decimal"
			placeholder={ isFocused ? '' : __( 'Empty', 'cortext' ) }
			type="text"
			value={ draft }
			onBlur={ () => {
				setIsFocused( false );
				const parsed = parseNumberPropertyValue( draft );

				if ( parsed.valid && parsed.complete ) {
					setDraft(
						parsed.value === null ? '' : String( parsed.value )
					);
					return;
				}

				setDraft( committedTextRef.current );
			} }
			onChange={ ( event ) => commitDraft( event.currentTarget.value ) }
			onFocus={ () => setIsFocused( true ) }
		/>
	);
}

function PropertyControl( {
	field,
	value,
	elements,
	onChange,
	onOptionsSaved,
	onRowsChanged,
} ) {
	const type = fieldType( field );
	const label = field.label;

	if ( type === 'checkbox' ) {
		return (
			<CheckboxControl
				label=""
				aria-label={ label }
				checked={ Boolean( value ) }
				onChange={ ( next ) => onChange( next ) }
				__nextHasNoMarginBottom
			/>
		);
	}

	if ( type === 'number' ) {
		return (
			<EditableNumberPropertyText
				label={ label }
				value={ value }
				onChange={ onChange }
			/>
		);
	}

	if ( type === 'select' ) {
		return (
			<SelectPropertyControl
				field={ field }
				value={ value }
				elements={ elements }
				onChange={ onChange }
				onOptionsSaved={ onOptionsSaved }
				onRowsChanged={ onRowsChanged }
			/>
		);
	}

	if ( type === 'multiselect' ) {
		return (
			<MultiselectPropertyControl
				field={ field }
				value={ value }
				elements={ elements }
				onChange={ onChange }
				onOptionsSaved={ onOptionsSaved }
				onRowsChanged={ onRowsChanged }
			/>
		);
	}

	if ( type === 'date' || type === 'datetime' ) {
		return (
			<DatePropertyControl
				field={ field }
				value={ value }
				type={ type }
				onChange={ onChange }
			/>
		);
	}

	let textInputMode;
	if ( type === 'email' ) {
		textInputMode = 'email';
	} else if ( type === 'url' ) {
		textInputMode = 'url';
	}

	return (
		<EditablePropertyText
			label={ label }
			inputMode={ textInputMode }
			value={ value ?? '' }
			onChange={ onChange }
		/>
	);
}

/**
 * Renders the row's collection-field properties as document chrome above the
 * block editor. This is intentionally not serialized yet; see
 * tech-debt.md#41 for the block-backed version needed for frontend rendering.
 *
 * @param {Object} props
 * @param {Array}  props.fields The collection field definitions for this row.
 * @param {Object} [props.row]  Optional fallback row record (used for
 *                              read-only fields that aren't tracked by the
 *                              editor store, e.g. relations and rollups).
 */
export default function RowProperties( { fields, row } ) {
	const { editPost } = useDispatch( editorStore );
	const { optionOverrides, updateFieldOptions, refreshRows } =
		useContext( RowMutationContext );

	// The locked `core/post-title` block above already exposes the title;
	// duplicating it as a property row would give the user two edit surfaces
	// for the same value.
	const propertyFields = useMemo(
		() =>
			Array.isArray( fields )
				? fields.filter( ( field ) => field.id !== TITLE_FIELD_ID )
				: [],
		[ fields ]
	);

	const { title, meta, hydratedMeta } = useSelect(
		( select ) => ( {
			title: select( editorStore ).getEditedPostAttribute( 'title' ),
			meta: select( editorStore ).getEditedPostAttribute( 'meta' ) ?? {},
			hydratedMeta: select( editorStore ).getEditedPostAttribute(
				'cortext_hydrated_meta'
			),
		} ),
		[]
	);

	const data = useMemo( () => {
		const storeHydratedMeta =
			hydratedMeta && Object.keys( hydratedMeta ).length > 0
				? hydratedMeta
				: null;
		return {
			row,
			title:
				typeof title === 'string'
					? title
					: row?.title?.raw ?? row?.title?.rendered ?? '',
			meta: meta ?? {},
			hydratedMeta: storeHydratedMeta ?? row?.cortext_hydrated_meta ?? {},
		};
	}, [ hydratedMeta, meta, row, title ] );

	const update = useCallback(
		( patch ) => {
			const split = splitPropertyPatch( patch );
			const next = {};
			if ( split.title !== undefined ) {
				next.title = split.title;
			}
			if ( split.meta ) {
				next.meta = split.meta;
			}
			if ( Object.keys( next ).length > 0 ) {
				editPost( next );
			}
		},
		[ editPost ]
	);

	if ( propertyFields.length === 0 ) {
		return null;
	}

	const fieldCountLabel = sprintf(
		/* translators: %d: Number of row fields. */
		_n( '%d field', '%d fields', propertyFields.length, 'cortext' ),
		propertyFields.length
	);

	return (
		<div
			className="cortext-row-detail__properties cortext-row-detail__properties--rows"
			aria-label={ fieldCountLabel }
		>
			{ propertyFields.map( ( field ) => {
				const isEditable = isRowDetailFieldEditable( field );
				const value = valueForField( field, data );
				const type = fieldType( field );
				const elements =
					optionOverrides?.[ field.id ] ??
					field.cortextElements ??
					field.elements ??
					[];
				let propertyIcon = null;
				if ( isCollectionField( field ) ) {
					propertyIcon = (
						<FieldTypeIcon
							type={ type }
							className="cortext-row-detail__property-type-icon"
						/>
					);
				} else if ( hasInternalFieldIcon( field ) ) {
					propertyIcon = (
						<SystemFieldIcon
							fieldId={ field.id }
							className="cortext-row-detail__property-type-icon"
						/>
					);
				}

				return (
					<div
						key={ field.id }
						className={
							'cortext-row-detail__property' +
							( isEditable
								? ' cortext-row-detail__property--editable'
								: ' cortext-row-detail__property--readonly' )
						}
					>
						<div className="cortext-row-detail__property-label">
							{ propertyIcon }
							<span className="cortext-row-detail__property-label-text">
								{ field.label }
							</span>
						</div>
						<div className="cortext-row-detail__property-value">
							{ isEditable ? (
								<PropertyControl
									field={ field }
									value={ value }
									elements={ elements }
									onChange={ ( next ) =>
										update( { [ field.id ]: next } )
									}
									onOptionsSaved={ ( nextOptions ) =>
										updateFieldOptions?.(
											field.cortextRecordId ??
												toRecordId( field.id ),
											nextOptions
										)
									}
									onRowsChanged={ refreshRows }
								/>
							) : (
								<ReadOnlyProperty
									value={ value }
									type={ type }
									elements={ elements }
									format={ field.cortextFormat }
								/>
							) }
						</div>
					</div>
				);
			} ) }
		</div>
	);
}
