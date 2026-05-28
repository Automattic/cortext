/**
 * Property panel for a row document. It renders one row per collection field
 * with the edit control that matches the field type. Row detail chrome and the
 * locked document-properties editor block both mount this; see tech-debt.md#td-row-properties-public-render
 * for the remaining public-rendering work.
 *
 * Reads the post's edited title and meta from `editorStore` so the live
 * values stay in sync with the locked `core/post-title` block above and
 * any field changes that flow through autosave.
 */

import apiFetch from '@wordpress/api-fetch';
import { Button, CheckboxControl } from '@wordpress/components';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import {
	Fragment,
	useCallback,
	useContext,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import { dragHandle, seen, unseen } from '@wordpress/icons';
import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	pointerWithin,
	useDroppable,
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
	DateEditor,
	RowMutationContext,
	SelectEditor,
	formatDisplay,
} from './EditableCell';
import { TITLE_FIELD_ID } from './dataViewColumns';
import FieldActionsMenu from './fields/FieldActionsMenu';
import { FieldTypeIcon, SystemFieldIcon } from './fields/fieldTypes';
import { hasSystemFieldIcon } from './fields/systemFieldIconIds';
import Infotip from './Infotip';
import MultiselectEdit from './MultiselectEdit';
import { toRecordId } from '../hooks/fieldIds';
import { elementsFromOptions } from '../hooks/optionElements';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';
import {
	isRowDetailFieldEditable,
	isValidNumberDraft,
	parseNumberPropertyValue,
	relationTargetCollectionId,
	rowDetailDisplayFieldType as displayFieldType,
	rowDetailFieldType as fieldType,
	splitPropertyPatch,
	valueForField,
} from './rowDetailUtils';
import RelationEditor from './relations/RelationEditor';

export const HIDDEN_PROPERTIES_DROP_TARGET =
	'cortext-row-properties-hidden-drop-target';

function rowPropertiesCollisionDetection( args ) {
	const pointerCollisions = pointerWithin( args );
	const hiddenDropTarget = pointerCollisions.find(
		( collision ) => collision.id === HIDDEN_PROPERTIES_DROP_TARGET
	);
	return hiddenDropTarget ? [ hiddenDropTarget ] : closestCenter( args );
}

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

function EmptyHiddenPropertiesDropZone( { placeholderHeight } ) {
	const { isOver, setNodeRef } = useDroppable( {
		id: HIDDEN_PROPERTIES_DROP_TARGET,
	} );
	return (
		<div
			ref={ setNodeRef }
			className="cortext-row-detail__property-hidden-dropzone-wrap"
		>
			{ placeholderHeight ? (
				<div
					className="cortext-row-detail__property-hidden-placeholder"
					style={ { height: placeholderHeight } }
				/>
			) : null }
			<div className="cortext-row-detail__property-hidden-separator">
				<span>{ __( 'Hidden properties', 'cortext' ) }</span>
			</div>
			<div
				className={
					'cortext-row-detail__property-hidden-dropzone' +
					( isOver ? ' is-over' : '' )
				}
				aria-label={ __(
					'Drop properties here to hide them',
					'cortext'
				) }
			/>
		</div>
	);
}

function RowPropertyDragOverlay( {
	data,
	field,
	formatOverrides,
	localFormatOverrides,
	localOptionOverrides,
	optionOverrides,
	width,
} ) {
	if ( ! field ) {
		return null;
	}
	const type = fieldType( field );
	const displayType = displayFieldType( field );
	const value = valueForField( field, data );
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
			className="cortext-row-detail__property cortext-row-detail__property--layout-editing cortext-row-detail__property-drag-overlay"
			style={ width ? { width } : undefined }
		>
			<div className="cortext-row-detail__property-label">
				<span className="cortext-row-detail__property-label-icon-slot">
					<span
						className="cortext-row-detail__property-layout-chip components-button"
						aria-hidden="true"
					/>
					{ propertyIcon }
				</span>
				<span className="cortext-row-detail__property-label-content">
					<span className="cortext-row-detail__property-label-text">
						{ field.label }
					</span>
				</span>
			</div>
			<div className="cortext-row-detail__property-value">
				<div className="cortext-row-detail__property-value-content">
					<ReadOnlyProperty
						value={ value }
						type={ displayType }
						elements={ elements }
						format={ format }
					/>
				</div>
			</div>
		</div>
	);
}

function HiddenPropertiesSeparator() {
	const { setNodeRef, transform, transition } = useSortable( {
		id: HIDDEN_PROPERTIES_DROP_TARGET,
	} );
	const style = {
		transform: transformToString( transform ),
		transition,
	};
	return (
		<div
			ref={ setNodeRef }
			style={ style }
			className="cortext-row-detail__property-hidden-separator"
		>
			<span>{ __( 'Hidden properties', 'cortext' ) }</span>
		</div>
	);
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

function relationConfigForField( field ) {
	return {
		targetCollectionId: relationTargetCollectionId( field ),
		multiple: field.relation?.multiple ?? field.relationMultiple ?? true,
	};
}

function EditablePropertyText( { label, inputMode, value, onChange } ) {
	const textValue =
		value === null || value === undefined ? '' : String( value );
	const [ draft, setDraft ] = useState( textValue );
	const [ isFocused, setIsFocused ] = useState( false );
	const controlRef = useRef( null );
	const resizeControl = useCallback( () => {
		const control = controlRef.current;
		if ( ! control ) {
			return;
		}
		const width =
			control.getBoundingClientRect?.().width ?? control.clientWidth;
		control.style.height = '30px';
		if ( ! Number.isFinite( width ) || width < 24 ) {
			return;
		}
		control.style.height = `${ Math.max( 30, control.scrollHeight ) }px`;
	}, [] );

	useEffect( () => {
		if ( ! isFocused ) {
			setDraft( textValue );
		}
	}, [ isFocused, textValue ] );

	useLayoutEffect( () => {
		resizeControl();
	}, [ draft, resizeControl ] );

	useLayoutEffect( () => {
		const control = controlRef.current;
		if (
			! control ||
			typeof window === 'undefined' ||
			typeof window.ResizeObserver === 'undefined'
		) {
			return undefined;
		}
		let frame = null;
		const scheduleResize = () => {
			if ( frame ) {
				window.cancelAnimationFrame( frame );
			}
			frame = window.requestAnimationFrame( () => {
				frame = null;
				resizeControl();
			} );
		};
		const observer = new window.ResizeObserver( scheduleResize );
		observer.observe( control );
		scheduleResize();
		return () => {
			observer.disconnect();
			if ( frame ) {
				window.cancelAnimationFrame( frame );
			}
		};
	}, [ resizeControl ] );

	return (
		<textarea
			aria-label={ label }
			ref={ controlRef }
			className="cortext-row-detail__property-editable-text"
			inputMode={ inputMode }
			placeholder={ isFocused ? '' : __( 'Empty', 'cortext' ) }
			rows={ 1 }
			value={ draft }
			onBlur={ () => setIsFocused( false ) }
			onChange={ ( event ) => {
				const next = event.currentTarget.value.replace(
					/[\r\n]+/g,
					' '
				);
				setDraft( next );
				onChange( next );
			} }
			onFocus={ () => setIsFocused( true ) }
			onKeyDown={ ( event ) => {
				if ( event.key === 'Enter' ) {
					event.preventDefault();
				}
			} }
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
	const showRawInputValue = useCallback(
		( input ) => {
			input.value = textValue;
			setDraft( textValue );
			setIsFocused( true );
		},
		[ textValue ]
	);
	const focusRawInputValue = useCallback(
		( input ) => {
			showRawInputValue( input );
			input.focus();
			input.select();
		},
		[ showRawInputValue ]
	);
	const handleInputInteractionStart = useCallback(
		( event ) => {
			event.stopPropagation();
			if (
				! isFocused ||
				event.currentTarget.ownerDocument.activeElement !==
					event.currentTarget
			) {
				focusRawInputValue( event.currentTarget );
			}
		},
		[ focusRawInputValue, isFocused ]
	);
	const stopInputPropagation = useCallback( ( event ) => {
		event.stopPropagation();
	}, [] );

	useEffect( () => {
		committedTextRef.current = textValue;
		committedValueRef.current = value ?? null;

		if ( ! isFocused ) {
			setDraft( textValue );
		}
	}, [ isFocused, textValue, value ] );

	useLayoutEffect( () => {
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
				onMouseDown={ stopInputPropagation }
				onPointerDown={ stopInputPropagation }
				onClick={ ( event ) => {
					event.stopPropagation();
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
			onClick={ stopInputPropagation }
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
			onMouseDown={ handleInputInteractionStart }
			onPointerDown={ handleInputInteractionStart }
			onFocus={ ( event ) => {
				// The resting value may include formatting (for example
				// thousands separators). Swap the DOM value immediately so
				// keyboard input after focus edits the raw number.
				showRawInputValue( event.currentTarget );
			} }
		/>
	);
}

function PropertyControl( {
	field,
	value,
	elements,
	relation,
	onChange,
	onRelationChange,
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
			<SelectEditor
				recordId={ field.cortextRecordId ?? toRecordId( field.id ) }
				value={ value }
				elements={ elements }
				onCommit={ ( next ) => {
					onChange( next );
					return true;
				} }
				onOptionsSaved={ onOptionsSaved }
				onRowsChanged={ onRowsChanged }
				label={ label }
				defaultOpen={ false }
				triggerClassName="cortext-row-detail__property-trigger cortext-select-edit__toggle"
				placeholder={ __( 'Empty', 'cortext' ) }
			/>
		);
	}

	if ( type === 'multiselect' ) {
		return (
			<MultiselectEdit
				recordId={ field.cortextRecordId ?? toRecordId( field.id ) }
				value={ Array.isArray( value ) ? value : [] }
				elements={ elements }
				onSave={ onChange }
				onOptionsSaved={ onOptionsSaved }
				onRowsChanged={ onRowsChanged }
				label={ label }
				defaultOpen={ false }
				triggerClassName="cortext-row-detail__property-trigger cortext-multiselect-edit__toggle"
			/>
		);
	}

	if ( type === 'date' || type === 'datetime' ) {
		return (
			<DateEditor
				value={ value }
				type={ type }
				format={ field.cortextFormat }
				onCommit={ ( next ) => {
					onChange( next );
					return true;
				} }
				label={ label }
				defaultOpen={ false }
				triggerClassName="cortext-row-detail__property-trigger cortext-date-edit__toggle"
				emptyLabel={ __( 'Empty', 'cortext' ) }
				contentClassName="cortext-row-detail__date-popover"
				closeOnCommit={ false }
			/>
		);
	}

	if ( type === 'relation' ) {
		return (
			<RelationEditor
				value={ Array.isArray( value ) ? value : [] }
				relation={ relation }
				onSave={ onRelationChange }
				onCancel={ () => {} }
				label={ label }
				defaultOpen={ false }
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
	const description = field.description?.trim() ?? '';
	if ( ! collectionId || ! recordId ) {
		return (
			<>
				<span className="cortext-row-detail__property-label-text">
					{ field.label }
				</span>
				{ description ? (
					<Infotip
						description={ description }
						label={ sprintf(
							/* translators: %s: field label */
							__( 'About %s', 'cortext' ),
							field.label
						) }
						placement="bottom"
					/>
				) : null }
			</>
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

function skipSortableLayoutAnimation() {
	return false;
}

function blurActiveLayoutChip( node ) {
	const activeElement = node?.ownerDocument?.activeElement;
	if (
		activeElement?.classList?.contains(
			'cortext-row-detail__property-layout-chip'
		)
	) {
		activeElement.blur();
	}
}

function measuredElementWidth( node ) {
	const width = node?.getBoundingClientRect?.().width;
	return Number.isFinite( width ) && width > 0 ? width : null;
}

function measuredElementHeight( node ) {
	const height = node?.getBoundingClientRect?.().height;
	return Number.isFinite( height ) && height > 0 ? height : null;
}

function findPropertyElement( container, fieldId ) {
	if ( ! container || ! fieldId ) {
		return null;
	}
	return (
		Array.from(
			container.querySelectorAll( '[data-cortext-property-id]' )
		).find(
			( node ) => node.dataset.cortextPropertyId === String( fieldId )
		) ?? null
	);
}

function RowProperty( {
	canReorderLayout,
	collectionId,
	data,
	field,
	formatOverrides,
	handleFieldFormatSaved,
	handleFieldOptionsSaved,
	isLayoutEditing,
	isDragging,
	isCollapsedForHiddenDrop,
	localFormatOverrides,
	localOptionOverrides,
	onLayoutVisibilityToggle,
	optionOverrides,
	refreshRows,
	reorderAttributes,
	reorderListeners,
	rowRef,
	rowId,
	rowStyle,
	update,
	updateRelation,
} ) {
	const relation = relationConfigForField( field );
	const editContext = { collectionId, rowId };
	const isEditable = isRowDetailFieldEditable( field, editContext );
	const value = valueForField( field, data );
	const type = fieldType( field );
	const displayType = displayFieldType( field );
	const isVisibleInLayout = field.cortextDetailVisible !== false;
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
	let propertyValue = (
		<ReadOnlyProperty
			value={ value }
			type={ displayType }
			elements={ elements }
			format={ format }
		/>
	);
	if ( isEditable ) {
		propertyValue = (
			<PropertyControl
				field={ displayField }
				value={ value }
				elements={ elements }
				relation={ relation }
				onChange={ ( next ) => update( { [ field.id ]: next } ) }
				onRelationChange={ ( next ) =>
					updateRelation( field.id, next )
				}
				onOptionsSaved={ ( nextOptions ) =>
					handleFieldOptionsSaved(
						field.cortextRecordId ?? toRecordId( field.id ),
						nextOptions
					)
				}
				onRowsChanged={ refreshRows }
			/>
		);
	}

	return (
		<div
			ref={ rowRef }
			style={ rowStyle }
			data-cortext-property-id={ field.id }
			className={
				'cortext-row-detail__property' +
				( isEditable
					? ' cortext-row-detail__property--editable'
					: ' cortext-row-detail__property--readonly' ) +
				( isLayoutEditing
					? ' cortext-row-detail__property--layout-editing'
					: '' ) +
				( isVisibleInLayout ? '' : ' is-hidden' ) +
				( isDragging ? ' is-dragging' : '' ) +
				( isCollapsedForHiddenDrop
					? ' is-collapsed-for-hidden-drop'
					: '' )
			}
		>
			<div className="cortext-row-detail__property-label">
				<span className="cortext-row-detail__property-label-icon-slot">
					{ canReorderLayout ? (
						<Button
							className="cortext-row-detail__property-layout-chip"
							aria-label={ __( 'Reorder property', 'cortext' ) }
							icon={ dragHandle }
							size="small"
							variant="tertiary"
							{ ...reorderAttributes }
							{ ...reorderListeners }
						/>
					) : null }
					{ propertyIcon }
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
				<div className="cortext-row-detail__property-value-content">
					{ propertyValue }
				</div>
				{ isLayoutEditing ? (
					<Button
						className="cortext-row-detail__property-visibility"
						icon={ isVisibleInLayout ? seen : unseen }
						label={
							isVisibleInLayout
								? __( 'Hide property', 'cortext' )
								: __( 'Show property', 'cortext' )
						}
						isPressed={ isVisibleInLayout }
						size="small"
						variant="tertiary"
						onClick={ () => onLayoutVisibilityToggle?.( field.id ) }
					/>
				) : null }
			</div>
		</div>
	);
}

function SortableRowProperty( props ) {
	const shouldSuppressDropAnimation =
		props.suppressDropAnimation && ! props.activeLayoutFieldId;
	const {
		attributes,
		isDragging,
		listeners,
		setNodeRef,
		transform,
		transition,
	} = useSortable( {
		id: props.field.id,
		animateLayoutChanges: shouldSuppressDropAnimation
			? skipSortableLayoutAnimation
			: undefined,
	} );
	const shouldDisableHiddenDropMotion =
		props.isDroppingIntoEmptyHiddenDrop || props.isCollapsedForHiddenDrop;
	const shouldDisableMotion =
		shouldDisableHiddenDropMotion || shouldSuppressDropAnimation;
	const style = {
		transform: shouldDisableMotion
			? undefined
			: transformToString( transform ),
		transition: shouldDisableMotion ? 'none' : transition,
	};

	return (
		<RowProperty
			{ ...props }
			canReorderLayout
			isDragging={
				isDragging && props.activeLayoutFieldId === props.field.id
			}
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
 * tech-debt.md#td-row-properties-public-render for the frontend rendering work.
 *
 * @param {Object}   props
 * @param {number}   props.collectionId The row's parent collection ID.
 * @param {Array}    props.fields       Fields shown for this row.
 * @param {boolean}  props.isLayoutEditing Whether the user is arranging properties.
 * @param {Function} props.onLayoutReorder Reorders fields from the properties list.
 * @param {Function} props.onLayoutVisibilityToggle Shows or hides a field in the layout.
 * @param {number}   [props.rowId]      The current row ID.
 * @param {Object}   [props.row]        Fallback row record for values outside editor state,
 *                                      such as relations and rollups.
 */
export default function RowProperties( {
	collectionId,
	fields,
	isLayoutEditing = false,
	onLayoutReorder,
	onLayoutVisibilityToggle,
	row,
	rowId: providedRowId,
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
	const [ activeLayoutFieldId, setActiveLayoutFieldId ] = useState( null );
	const [ activeLayoutOverId, setActiveLayoutOverId ] = useState( null );
	const [ activeLayoutOverlayWidth, setActiveLayoutOverlayWidth ] =
		useState( null );
	const [ activeLayoutPlaceholderHeight, setActiveLayoutPlaceholderHeight ] =
		useState( null );
	const [
		suppressedDropAnimationFieldId,
		setSuppressedDropAnimationFieldId,
	] = useState( null );
	const propertiesRef = useRef( null );
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
	const [ savedRow, setSavedRow ] = useState( null );
	const rowId = savedRow?.id ?? providedRowId ?? row?.id;
	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 4 } } ),
		useSensor( KeyboardSensor, {
			coordinateGetter: sortableKeyboardCoordinates,
		} )
	);

	useEffect( () => {
		setSavedRow( null );
	}, [ row?.id ] );

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
		const fallbackHydratedMeta = row?.cortext_hydrated_meta ?? {};
		const savedHydratedMeta = savedRow?.meta ?? {};
		return {
			row: savedRow ?? row,
			title:
				typeof title === 'string'
					? title
					: savedRow?.title?.raw ??
					  savedRow?.title?.rendered ??
					  row?.title?.raw ??
					  row?.title?.rendered ??
					  '',
			meta: { ...( savedRow?.meta ?? {} ), ...( meta ?? {} ) },
			hydratedMeta: {
				...( storeHydratedMeta ?? {} ),
				...fallbackHydratedMeta,
				...savedHydratedMeta,
			},
			editContext: { collectionId, rowId },
		};
	}, [ collectionId, hydratedMeta, meta, row, rowId, savedRow, title ] );

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
	const handleDragStart = useCallback( ( event ) => {
		const activeFieldId = event.active?.id ?? null;
		const activeProperty = findPropertyElement(
			propertiesRef.current,
			activeFieldId
		);
		setActiveLayoutFieldId( activeFieldId );
		setActiveLayoutOverId( null );
		setSuppressedDropAnimationFieldId( null );
		setActiveLayoutOverlayWidth(
			measuredElementWidth( activeProperty ) ??
				event.active?.rect?.current?.initial?.width ??
				measuredElementWidth( propertiesRef.current )
		);
		setActiveLayoutPlaceholderHeight(
			measuredElementHeight( activeProperty ) ??
				event.active?.rect?.current?.initial?.height ??
				null
		);
	}, [] );
	const handleDragOver = useCallback( ( event ) => {
		setActiveLayoutOverId( event.over?.id ?? null );
	}, [] );
	const sortableIds = useMemo( () => {
		return propertyFields.flatMap( ( field, index ) => {
			const startsHiddenGroup =
				isLayoutEditing &&
				field.cortextDetailVisible === false &&
				propertyFields[ index - 1 ]?.cortextDetailVisible !== false;
			return startsHiddenGroup
				? [ HIDDEN_PROPERTIES_DROP_TARGET, field.id ]
				: [ field.id ];
		} );
	}, [ isLayoutEditing, propertyFields ] );
	const handleDragEnd = useCallback(
		( event ) => {
			const { active, over } = event;
			const droppedIntoEmptyHidden =
				isLayoutEditing &&
				over?.id === HIDDEN_PROPERTIES_DROP_TARGET &&
				! propertyFields.some(
					( field ) => field.cortextDetailVisible === false
				);
			setActiveLayoutFieldId( null );
			setActiveLayoutOverId( null );
			setActiveLayoutOverlayWidth( null );
			setActiveLayoutPlaceholderHeight( null );
			setSuppressedDropAnimationFieldId(
				droppedIntoEmptyHidden ? active?.id ?? null : null
			);
			blurActiveLayoutChip( propertiesRef.current );
			if ( ! over || active.id === over.id ) {
				return;
			}
			onLayoutReorder?.( active.id, over.id );
		},
		[ isLayoutEditing, onLayoutReorder, propertyFields ]
	);
	const handleDragCancel = useCallback( () => {
		setActiveLayoutFieldId( null );
		setActiveLayoutOverId( null );
		setActiveLayoutOverlayWidth( null );
		setActiveLayoutPlaceholderHeight( null );
		setSuppressedDropAnimationFieldId( null );
		blurActiveLayoutChip( propertiesRef.current );
	}, [] );

	const updateRelation = useCallback(
		async ( fieldId, next ) => {
			if ( ! collectionId || ! rowId ) {
				return null;
			}
			// `fieldId` is the DataView field id (`field-<post_id>`), which is
			// also the post meta key on the row document.
			const updated = await apiFetch( {
				path: `/wp/v2/crtxt_documents/${ rowId }`,
				method: 'POST',
				data: {
					meta: { [ fieldId ]: next },
				},
			} );
			setSavedRow( updated );
			refreshRows?.();
			notifyCollectionRowsChanged( collectionId );
			return updated;
		},
		[ collectionId, refreshRows, rowId ]
	);

	if ( propertyFields.length === 0 ) {
		return null;
	}

	const hasHiddenFields = propertyFields.some(
		( field ) => field.cortextDetailVisible === false
	);
	const activeLayoutField = activeLayoutFieldId
		? propertyFields.find( ( field ) => field.id === activeLayoutFieldId )
		: null;
	const isDroppingIntoEmptyHidden =
		isLayoutEditing &&
		! hasHiddenFields &&
		activeLayoutFieldId &&
		activeLayoutOverId === HIDDEN_PROPERTIES_DROP_TARGET;
	const fieldCountLabel = sprintf(
		/* translators: %d: Number of row fields. */
		_n( '%d field', '%d fields', propertyFields.length, 'cortext' ),
		propertyFields.length
	);
	const renderProperty = ( field ) =>
		canReorderLayout ? (
			<SortableRowProperty
				key={ field.id }
				collectionId={ collectionId }
				data={ data }
				field={ field }
				activeLayoutFieldId={ activeLayoutFieldId }
				formatOverrides={ formatOverrides }
				handleFieldFormatSaved={ handleFieldFormatSaved }
				handleFieldOptionsSaved={ handleFieldOptionsSaved }
				isCollapsedForHiddenDrop={
					isDroppingIntoEmptyHidden &&
					field.id === activeLayoutFieldId
				}
				isDroppingIntoEmptyHiddenDrop={ isDroppingIntoEmptyHidden }
				isLayoutEditing={ isLayoutEditing }
				localFormatOverrides={ localFormatOverrides }
				localOptionOverrides={ localOptionOverrides }
				onLayoutVisibilityToggle={ onLayoutVisibilityToggle }
				optionOverrides={ optionOverrides }
				refreshRows={ refreshRows }
				rowId={ rowId }
				suppressDropAnimation={
					suppressedDropAnimationFieldId === field.id
				}
				update={ update }
				updateRelation={ updateRelation }
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
				isCollapsedForHiddenDrop={ false }
				isLayoutEditing={ isLayoutEditing }
				localFormatOverrides={ localFormatOverrides }
				localOptionOverrides={ localOptionOverrides }
				onLayoutVisibilityToggle={ onLayoutVisibilityToggle }
				optionOverrides={ optionOverrides }
				refreshRows={ refreshRows }
				rowId={ rowId }
				update={ update }
				updateRelation={ updateRelation }
			/>
		);

	const rows = (
		<div
			ref={ propertiesRef }
			className="cortext-row-detail__properties cortext-row-detail__properties--rows"
			aria-label={ fieldCountLabel }
		>
			{ propertyFields.map( ( field, index ) => {
				const startsHiddenGroup =
					isLayoutEditing &&
					field.cortextDetailVisible === false &&
					propertyFields[ index - 1 ]?.cortextDetailVisible !== false;
				return (
					<Fragment key={ field.id }>
						{ startsHiddenGroup ? (
							<HiddenPropertiesSeparator
								key={ HIDDEN_PROPERTIES_DROP_TARGET }
							/>
						) : null }
						{ renderProperty( field ) }
					</Fragment>
				);
			} ) }
			{ isLayoutEditing && ! hasHiddenFields ? (
				<EmptyHiddenPropertiesDropZone
					key={ HIDDEN_PROPERTIES_DROP_TARGET }
					placeholderHeight={
						isDroppingIntoEmptyHidden
							? activeLayoutPlaceholderHeight
							: null
					}
				/>
			) : null }
		</div>
	);

	if ( ! canReorderLayout ) {
		return rows;
	}

	return (
		<DndContext
			sensors={ sensors }
			collisionDetection={ rowPropertiesCollisionDetection }
			onDragCancel={ handleDragCancel }
			onDragEnd={ handleDragEnd }
			onDragOver={ handleDragOver }
			onDragStart={ handleDragStart }
		>
			<SortableContext
				items={ sortableIds }
				strategy={ verticalListSortingStrategy }
			>
				{ rows }
			</SortableContext>
			<DragOverlay dropAnimation={ null }>
				<RowPropertyDragOverlay
					data={ data }
					field={ activeLayoutField }
					formatOverrides={ formatOverrides }
					localFormatOverrides={ localFormatOverrides }
					localOptionOverrides={ localOptionOverrides }
					optionOverrides={ optionOverrides }
					width={ activeLayoutOverlayWidth }
				/>
			</DragOverlay>
		</DndContext>
	);
}
