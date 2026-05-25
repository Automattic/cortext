/**
 * Property panel for a row document. Renders one row per collection field
 * with the right edit affordance for that field type. Mounted by row detail
 * chrome and full-page row chrome for now; see tech-debt.md#42 for the
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
import { dragHandle } from '@wordpress/icons';
import {
	DndContext,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	useSensor,
	useSensors,
} from '@dnd-kit/core';
import {
	SortableContext,
	sortableKeyboardCoordinates,
	useSortable,
	verticalListSortingStrategy,
} from '@dnd-kit/sortable';

import {
	RowMutationContext,
	dateOnlyValue,
	formatDisplay,
} from './EditableCell';
import { TITLE_FIELD_ID } from './dataViewColumns';
import FieldActionsMenu from './fields/FieldActionsMenu';
import EditOptionsPopover from './fields/EditOptionsPopover';
import { FieldTypeIcon, SystemFieldIcon } from './fields/fieldTypes';
import { hasSystemFieldIcon } from './fields/systemFieldIconIds';
import { toRecordId } from '../hooks/fieldIds';
import { elementsFromOptions } from '../hooks/optionElements';
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

function EditableNumberPropertyText( { label, value, format, onChange } ) {
	const textValue =
		value === null || value === undefined ? '' : String( value );
	const inputRef = useRef( null );
	const committedTextRef = useRef( textValue );
	const committedValueRef = useRef( value ?? null );
	const [ draft, setDraft ] = useState( textValue );
	const [ isFocused, setIsFocused ] = useState( false );
	const formattedDisplay = useMemo( () => {
		if ( textValue === '' || ! format ) {
			return textValue;
		}
		return formatDisplay( value, 'number', { format } );
	}, [ format, textValue, value ] );
	const formattedValue =
		typeof formattedDisplay === 'string' ? formattedDisplay : textValue;
	const hasRichDisplay =
		formattedDisplay !== '' && typeof formattedDisplay !== 'string';

	useEffect( () => {
		committedTextRef.current = textValue;
		committedValueRef.current = value ?? null;

		if ( ! isFocused ) {
			setDraft( textValue );
		}
	}, [ isFocused, textValue, value ] );

	useEffect( () => {
		if ( isFocused ) {
			inputRef.current?.focus();
			inputRef.current?.select();
		}
	}, [ isFocused ] );

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

	if ( hasRichDisplay && ! isFocused ) {
		return (
			<Button
				className="cortext-row-detail__property-trigger"
				variant="tertiary"
				onClick={ () => {
					setDraft( textValue );
					setIsFocused( true );
				} }
				aria-label={ label }
			>
				{ formattedDisplay }
			</Button>
		);
	}

	return (
		<input
			ref={ inputRef }
			aria-label={ label }
			className="cortext-row-detail__property-editable-text"
			inputMode="decimal"
			placeholder={ isFocused ? '' : __( 'Empty', 'cortext' ) }
			type="text"
			value={ isFocused ? draft : formattedValue }
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
			onFocus={ () => {
				setDraft( textValue );
				setIsFocused( true );
			} }
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
				format={ field.cortextFormat }
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

function PropertyLabel( {
	collectionId,
	field,
	onFieldOptionsSaved,
	onFieldFormatSaved,
	onRowsChanged,
} ) {
	const recordId = field.cortextRecordId ?? toRecordId( field.id );
	if ( ! collectionId || ! recordId ) {
		return (
			<span className="cortext-row-detail__property-label-text">
				{ field.label }
			</span>
		);
	}

	const configureLabel = sprintf(
		/* translators: %s: Field label. */
		__( 'Configure %s field', 'cortext' ),
		field.label
	);

	return (
		<FieldActionsMenu
			recordId={ recordId }
			collectionId={ collectionId }
			field={ field }
			className="cortext-row-detail__property-label-actions"
			triggerButton={
				<Button
					className="cortext-row-detail__property-label-button"
					variant="tertiary"
					label={ configureLabel }
				/>
			}
			triggerContent={
				<span className="cortext-row-detail__property-label-content">
					<span className="cortext-row-detail__property-label-text">
						{ field.label }
					</span>
				</span>
			}
			onFieldOptionsSaved={ onFieldOptionsSaved }
			onFieldFormatSaved={ onFieldFormatSaved }
			onRowsChanged={ onRowsChanged }
		/>
	);
}

function transformToString( transform ) {
	if ( ! transform ) {
		return undefined;
	}
	const { x = 0, y = 0, scaleX = 1, scaleY = 1 } = transform;
	return `translate3d(${ x }px, ${ y }px, 0) scaleX(${ scaleX }) scaleY(${ scaleY })`;
}

function RowProperty( {
	canReorderLayout,
	collectionId,
	data,
	field,
	formatOverrides,
	handleFieldFormatSaved,
	handleFieldOptionsSaved,
	isDragging,
	localFormatOverrides,
	localOptionOverrides,
	optionOverrides,
	refreshRows,
	reorderAttributes,
	reorderListeners,
	rowRef,
	rowStyle,
	update,
} ) {
	const isEditable = isRowDetailFieldEditable( field );
	const value = valueForField( field, data );
	const type = fieldType( field );
	const elements =
		localOptionOverrides?.[ field.id ] ??
		optionOverrides?.[ field.id ] ??
		field.cortextElements ??
		field.elements ??
		[];
	let format = field.cortextFormat;
	if ( formatOverrides?.[ field.id ] !== undefined ) {
		format = formatOverrides[ field.id ];
	}
	if ( localFormatOverrides?.[ field.id ] !== undefined ) {
		format = localFormatOverrides[ field.id ];
	}
	const displayField =
		elements !== field.cortextElements || format !== field.cortextFormat
			? {
					...field,
					cortextElements: elements,
					cortextFormat: format,
			  }
			: field;
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
			ref={ rowRef }
			style={ rowStyle }
			className={
				'cortext-row-detail__property' +
				( isEditable
					? ' cortext-row-detail__property--editable'
					: ' cortext-row-detail__property--readonly' ) +
				( isDragging ? ' is-dragging' : '' )
			}
		>
			<div className="cortext-row-detail__property-label">
				<span className="cortext-row-detail__property-label-icon-slot">
					{ propertyIcon }
					{ canReorderLayout ? (
						<Button
							className="cortext-row-detail__property-layout-chip"
							aria-label={ __( 'Reorder property', 'cortext' ) }
							icon={ dragHandle }
							label={ __( 'Reorder property', 'cortext' ) }
							size="small"
							variant="tertiary"
							{ ...reorderAttributes }
							{ ...reorderListeners }
						/>
					) : null }
				</span>
				<PropertyLabel
					collectionId={ collectionId }
					field={ displayField }
					onFieldOptionsSaved={ handleFieldOptionsSaved }
					onFieldFormatSaved={ handleFieldFormatSaved }
					onRowsChanged={ refreshRows }
				/>
			</div>
			<div className="cortext-row-detail__property-value">
				{ isEditable ? (
					<PropertyControl
						field={ displayField }
						value={ value }
						elements={ elements }
						onChange={ ( next ) =>
							update( { [ field.id ]: next } )
						}
						onOptionsSaved={ ( nextOptions ) =>
							handleFieldOptionsSaved(
								field.cortextRecordId ?? toRecordId( field.id ),
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
						format={ format }
					/>
				) }
			</div>
		</div>
	);
}

function SortableRowProperty( props ) {
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef,
		transform,
		transition,
	} = useSortable( { id: props.field.id } );
	const style = {
		transform: transformToString( transform ),
		transition,
	};

	return (
		<RowProperty
			{ ...props }
			canReorderLayout
			isDragging={ isDragging }
			reorderAttributes={ attributes }
			reorderListeners={ listeners }
			rowRef={ setNodeRef }
			rowStyle={ style }
		/>
	);
}

/*
 * Renders the row's collection-field properties as document chrome above the
 * block editor. This is intentionally not serialized yet; see
 * tech-debt.md#42 for the block-backed version needed for frontend rendering.
 */
export default function RowProperties( {
	collectionId,
	fields,
	onLayoutReorder,
	row,
} ) {
	const { editPost } = useDispatch( editorStore );
	const {
		optionOverrides,
		updateFieldOptions,
		formatOverrides,
		updateFieldFormat,
		refreshRows,
	} = useContext( RowMutationContext );
	const [ localOptionOverrides, setLocalOptionOverrides ] = useState( {} );
	const [ localFormatOverrides, setLocalFormatOverrides ] = useState( {} );
	const handleFieldOptionsSaved = useCallback(
		( recordId, nextOptions ) => {
			const fieldId = `field-${ recordId }`;
			const elements = elementsFromOptions( nextOptions ) || [];
			setLocalOptionOverrides( ( current ) => ( {
				...current,
				[ fieldId ]: elements,
			} ) );
			updateFieldOptions?.( recordId, nextOptions );
		},
		[ updateFieldOptions ]
	);
	const handleFieldFormatSaved = useCallback(
		( recordId, nextFormat ) => {
			const fieldId = `field-${ recordId }`;
			setLocalFormatOverrides( ( current ) => ( {
				...current,
				[ fieldId ]: nextFormat ?? null,
			} ) );
			updateFieldFormat?.( recordId, nextFormat );
		},
		[ updateFieldFormat ]
	);
	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 4 } } ),
		useSensor( KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		} )
	);

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
	const canReorderLayout =
		typeof onLayoutReorder === 'function' && propertyFields.length > 1;
	const sortableIds = useMemo(
		() => propertyFields.map( ( field ) => field.id ),
		[ propertyFields ]
	);
	const handleDragEnd = useCallback(
		( event ) => {
			const { active, over } = event;
			if ( ! over || active.id === over.id ) {
				return;
			}
			onLayoutReorder?.( active.id, over.id );
		},
		[ onLayoutReorder ]
	);

	if ( propertyFields.length === 0 ) {
		return null;
	}

	const fieldCountLabel = sprintf(
		/* translators: %d: Number of row fields. */
		_n( '%d field', '%d fields', propertyFields.length, 'cortext' ),
		propertyFields.length
	);

	const rows = (
		<div
			className="cortext-row-detail__properties cortext-row-detail__properties--rows"
			aria-label={ fieldCountLabel }
		>
			{ propertyFields.map( ( field ) =>
				canReorderLayout ? (
					<SortableRowProperty
						key={ field.id }
						collectionId={ collectionId }
						data={ data }
						field={ field }
						formatOverrides={ formatOverrides }
						handleFieldFormatSaved={ handleFieldFormatSaved }
						handleFieldOptionsSaved={ handleFieldOptionsSaved }
						localFormatOverrides={ localFormatOverrides }
						localOptionOverrides={ localOptionOverrides }
						optionOverrides={ optionOverrides }
						refreshRows={ refreshRows }
						update={ update }
					/>
				) : (
					<RowProperty
						key={ field.id }
						canReorderLayout={ false }
						collectionId={ collectionId }
						data={ data }
						field={ field }
						formatOverrides={ formatOverrides }
						handleFieldFormatSaved={ handleFieldFormatSaved }
						handleFieldOptionsSaved={ handleFieldOptionsSaved }
						localFormatOverrides={ localFormatOverrides }
						localOptionOverrides={ localOptionOverrides }
						optionOverrides={ optionOverrides }
						refreshRows={ refreshRows }
						update={ update }
					/>
				)
			) }
		</div>
	);

	if ( ! canReorderLayout ) {
		return rows;
	}

	return (
		<DndContext
			sensors={ sensors }
			collisionDetection={ closestCenter }
			onDragEnd={ handleDragEnd }
		>
			<SortableContext
				items={ sortableIds }
				strategy={ verticalListSortingStrategy }
			>
				{ rows }
			</SortableContext>
		</DndContext>
	);
}
