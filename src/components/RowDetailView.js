import { BlockCanvas, BlockList, useSettings } from '@wordpress/block-editor';
import {
	Button,
	CheckboxControl,
	DateTimePicker,
	Dropdown,
	Modal,
	Notice,
	Popover,
	Spinner,
} from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import {
	createPortal,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import {
	chevronDown,
	chevronUp,
	closeSmall,
	drawerRight,
	fullscreen,
	seen,
	square,
	unseen,
} from '@wordpress/icons';

import useAutosave from '../hooks/useAutosave';
import { toRecordId } from '../hooks/fieldIds';
import {
	RowMutationContext,
	dateOnlyValue,
	formatDisplay,
} from './EditableCell';
import { TITLE_FIELD_ID } from './dataViewColumns';
import EditOptionsPopover from './fields/EditOptionsPopover';
import {
	getRowDetailMode,
	isValidNumberDraft,
	parseNumberPropertyValue,
	splitPropertyPatch,
} from './rowDetailUtils';

export const ROW_DETAIL_MODE_ICONS = {
	side: drawerRight,
	modal: square,
	full: fullscreen,
};

export const ROW_DETAIL_MODE_LABELS = {
	side: __( 'Side peek', 'cortext' ),
	modal: __( 'Center modal', 'cortext' ),
	full: __( 'Full page', 'cortext' ),
};
const ROW_DETAIL_MODAL_CLOSE_MS = 240;
const ROW_DETAIL_SWITCH_MS = 180;
const ROW_DETAIL_SWITCH_FALLBACK_MS = ROW_DETAIL_SWITCH_MS + 100;

function delay( duration ) {
	return new Promise( ( resolve ) => {
		setTimeout( resolve, duration );
	} );
}

function detailKeyFor( detail ) {
	if ( ! detail ) {
		return null;
	}
	return `${ detail.postType }:${ detail.rowId }`;
}

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

function settleDetailPanes( panes ) {
	const enteringPane = panes.find( ( pane ) => pane.state === 'entering' );
	if ( enteringPane ) {
		return panes
			.filter(
				( pane ) =>
					pane.key === enteringPane.key || pane.state === 'preparing'
			)
			.map( ( pane ) =>
				pane.key === enteringPane.key
					? { ...pane, state: 'active' }
					: pane
			);
	}
	return panes.filter( ( pane ) => pane.state !== 'covered' );
}

function DetailReadySignal( { detailKey, onReady } ) {
	useEffect( () => {
		onReady( detailKey );
	}, [ detailKey, onReady ] );

	return null;
}

const ROW_DETAIL_EDITOR_CSS = `
	body {
		background: #fff;
	}

	.editor-styles-wrapper {
		box-sizing: border-box;
		min-height: 100%;
		padding: 24px 32px 48px;
	}

	.editor-styles-wrapper .wp-block-post-content {
		margin-block-start: 0;
	}

	.editor-styles-wrapper .block-editor-block-list__layout {
		min-height: 180px;
	}

	.editor-styles-wrapper .block-list-appender {
		margin-top: 12px;
	}
`;

function RowAutosaveBridge( { isActive = true, onApi, onSaved } ) {
	const { status, flushNow, isDirty, isSaving } = useAutosave( {
		debounceMs: 0,
		minSaveIntervalMs: 0,
	} );
	const { resetPost } = useDispatch( editorStore );
	const discard = useCallback( () => resetPost(), [ resetPost ] );
	const autosaveStateRef = useRef( { isDirty, isSaving } );
	autosaveStateRef.current = { isDirty, isSaving };
	const hasPendingEdits = useCallback(
		() =>
			autosaveStateRef.current.isDirty ||
			autosaveStateRef.current.isSaving,
		[]
	);

	useEffect( () => {
		if ( ! isActive ) {
			return undefined;
		}
		onApi?.( { flushNow, discard, hasPendingEdits } );
		return () => onApi?.( null );
	}, [ discard, flushNow, hasPendingEdits, isActive, onApi ] );

	useEffect( () => {
		if ( isActive && status === 'saved' ) {
			onSaved?.();
		}
	}, [ isActive, onSaved, status ] );

	return null;
}

function RowContentEditor() {
	const styles = useSelect(
		( select ) => select( editorStore ).getEditorSettings().styles,
		[]
	);
	const editorStyles = useMemo(
		() => [
			...Object.values( styles ?? [] ),
			{
				css: ROW_DETAIL_EDITOR_CSS,
			},
		],
		[ styles ]
	);
	const [ layout ] = useSettings( 'layout' );

	return (
		<div className="cortext-row-detail__content-editor">
			<BlockCanvas height="100%" styles={ editorStyles }>
				<BlockList
					className="wp-block-post-content is-layout-constrained has-global-padding"
					layout={ { type: 'constrained', ...layout } }
				/>
			</BlockCanvas>
		</div>
	);
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

function OptionPropertyValue( { value, type, elements } ) {
	const display = formatDisplay( value, type, { elements } );
	return display === '' ? emptyLabel() : display;
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

function fieldType( field ) {
	if ( field.id === TITLE_FIELD_ID ) {
		return 'text';
	}
	return field.cortextFieldType ?? field.type ?? 'text';
}

function isRowDetailFieldEditable( field ) {
	if ( fieldType( field ) === 'relation' ) {
		return false;
	}

	return (
		field.id === TITLE_FIELD_ID ||
		( field.editable && field.id?.startsWith?.( 'field-' ) )
	);
}

function valueForField( field, data ) {
	if ( field.id === TITLE_FIELD_ID ) {
		return data.title ?? '';
	}
	if ( field.id?.startsWith?.( 'field-' ) ) {
		return data.meta?.[ field.id ] ?? null;
	}
	return field.getValue?.( { item: data.row } ) ?? null;
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

function EditableRowTitle( { onTitle, row } ) {
	const { editPost } = useDispatch( editorStore );
	const editedTitle = useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'title' ),
		[]
	);
	const title =
		typeof editedTitle === 'string' ? editedTitle : titleFromRow( row );
	const [ draft, setDraft ] = useState( title );
	const [ isFocused, setIsFocused ] = useState( false );

	useEffect( () => {
		onTitle?.( title );
	}, [ onTitle, title ] );

	useEffect( () => {
		if ( ! isFocused ) {
			setDraft( title );
		}
	}, [ isFocused, title ] );

	return (
		<h2 className="cortext-row-detail__title">
			<input
				aria-label={ __( 'Title', 'cortext' ) }
				className="cortext-row-detail__title-input"
				placeholder={ __( 'Untitled', 'cortext' ) }
				type="text"
				value={ draft }
				onBlur={ () => setIsFocused( false ) }
				onChange={ ( event ) => {
					const next = event.currentTarget.value;
					setDraft( next );
					editPost( { title: next } );
				} }
				onFocus={ () => setIsFocused( true ) }
			/>
		</h2>
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

function PropertyValueMount( { fieldId, onMount } ) {
	const setRef = useCallback(
		( node ) => onMount( fieldId, node ),
		[ fieldId, onMount ]
	);

	return (
		<div
			className="cortext-row-detail__property-value-stack"
			ref={ setRef }
		/>
	);
}

function RowPropertyRows( { fields, onValueMount } ) {
	return (
		<div className="cortext-row-detail__properties cortext-row-detail__properties--rows">
			{ fields.map( ( field ) => {
				const isEditable = isRowDetailFieldEditable( field );

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
							{ field.label }
						</div>
						<div className="cortext-row-detail__property-value">
							<PropertyValueMount
								fieldId={ field.id }
								onMount={ onValueMount }
							/>
						</div>
					</div>
				);
			} ) }
		</div>
	);
}

function RowPropertyValues( {
	fields,
	mountNodes,
	row,
	state,
	isActive,
	isHidden,
} ) {
	const { editPost } = useDispatch( editorStore );
	const { optionOverrides, updateFieldOptions, refreshRows } =
		useContext( RowMutationContext );
	const { title, meta } = useSelect(
		( select ) => ( {
			title: select( editorStore ).getEditedPostAttribute( 'title' ),
			meta: select( editorStore ).getEditedPostAttribute( 'meta' ) ?? {},
		} ),
		[]
	);

	const data = useMemo(
		() => ( {
			row,
			title:
				typeof title === 'string'
					? title
					: row?.title?.raw ?? row?.title?.rendered ?? '',
			meta: meta ?? {},
		} ),
		[ meta, row, title ]
	);

	const update = useCallback(
		( patch ) => {
			const split = splitPropertyPatch( patch, meta );
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
		[ editPost, meta ]
	);

	return (
		<>
			{ fields.map( ( field ) => {
				const mountNode = mountNodes?.[ field.id ];
				if ( ! mountNode ) {
					return null;
				}

				const value = valueForField( field, data );
				const type = fieldType( field );
				const elements =
					optionOverrides?.[ field.id ] ??
					field.cortextElements ??
					field.elements ??
					[];
				const isEditable = isRowDetailFieldEditable( field );

				return createPortal(
					<div
						key={ field.id }
						className="cortext-row-detail__property-value-pane"
						data-state={ state }
						data-interactive={ isActive ? 'true' : 'false' }
						aria-hidden={ isHidden ? true : undefined }
						{ ...( isHidden ? { inert: '' } : {} ) }
					>
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
					</div>,
					mountNode
				);
			} ) }
		</>
	);
}

function RowPropertyValuesPortal( {
	fields,
	isActive,
	isHidden,
	mountNodes,
	row,
	state,
} ) {
	return (
		<RowPropertyValues
			fields={ fields }
			isActive={ isActive }
			isHidden={ isHidden }
			mountNodes={ mountNodes }
			row={ row }
			state={ state }
		/>
	);
}

export function ModeControl( { mode, onChangeMode } ) {
	const modes = Object.keys( ROW_DETAIL_MODE_LABELS ).filter(
		( nextMode ) => nextMode !== mode
	);

	return (
		<>
			{ modes.map( ( nextMode ) => (
				<Button
					key={ nextMode }
					className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
					icon={ ROW_DETAIL_MODE_ICONS[ nextMode ] }
					label={ ROW_DETAIL_MODE_LABELS[ nextMode ] }
					onClick={ () => {
						if ( mode !== nextMode ) {
							onChangeMode( nextMode );
						}
					} }
				/>
			) ) }
		</>
	);
}

function titleFromRow( row ) {
	const title = row?.title;
	if ( typeof title === 'string' ) {
		return title;
	}
	return title?.raw ?? title?.rendered ?? '';
}

function titleFromDetail( detail ) {
	if ( ! detail ) {
		return '';
	}
	return titleFromRow( detail.record ) || titleFromRow( detail.row );
}

function RowTitlePortal( { isActive, mountNode, onTitle, row } ) {
	if ( ! isActive || ! mountNode ) {
		return null;
	}

	return createPortal(
		<EditableRowTitle onTitle={ onTitle } row={ row } />,
		mountNode
	);
}

function DetailBody( {
	arePropertiesVisible,
	children,
	fields,
	fieldCountLabel,
	onValueMount,
} ) {
	return (
		<div className="cortext-row-detail__body">
			<div
				className="cortext-row-detail__properties-region"
				aria-hidden={ arePropertiesVisible ? undefined : true }
				{ ...( arePropertiesVisible ? {} : { inert: '' } ) }
			>
				<div className="cortext-row-detail__properties-region-inner">
					<div className="cortext-row-detail__properties-shell">
						<RowPropertyRows
							fields={ fields }
							onValueMount={ onValueMount }
						/>
					</div>
				</div>
			</div>
			<div
				className="cortext-row-detail__fields-indicator-wrap"
				aria-hidden={ arePropertiesVisible ? true : undefined }
				{ ...( arePropertiesVisible ? { inert: '' } : {} ) }
			>
				<div className="cortext-row-detail__fields-indicator-inner">
					<div
						className="cortext-row-detail__fields-indicator"
						aria-label={ sprintf(
							/* translators: %s: Number of hidden fields. */
							__( '%s hidden', 'cortext' ),
							fieldCountLabel
						) }
					>
						{ fieldCountLabel }
					</div>
				</div>
			</div>
			{ children }
		</div>
	);
}

function DetailPaneContent( {
	fields,
	isActive,
	isHidden,
	isTitleActive,
	onApi,
	onSaved,
	onTitle,
	propertyValueMounts,
	row,
	state,
	titleMountNode,
} ) {
	return (
		<>
			<RowAutosaveBridge
				isActive={ isActive }
				onApi={ onApi }
				onSaved={ onSaved }
			/>
			<RowTitlePortal
				isActive={ isTitleActive }
				mountNode={ titleMountNode }
				onTitle={ onTitle }
				row={ row }
			/>
			<RowPropertyValuesPortal
				fields={ fields }
				isActive={ isActive }
				isHidden={ isHidden }
				mountNodes={ propertyValueMounts }
				row={ row }
				state={ state }
			/>
			<RowContentEditor />
		</>
	);
}

function DetailShell( {
	arePropertiesVisible,
	children,
	fields,
	mode,
	onClose,
	onDiscardPending,
	onModeChange,
	onNext,
	onPrevious,
	onRetryPending,
	saveError,
	canGoNext,
	canGoPrevious,
	setArePropertiesVisible,
	title,
} ) {
	const [ propertyValueMounts, setPropertyValueMounts ] = useState( {} );
	const [ titleMountNode, setTitleMountNode ] = useState( null );
	const setPropertyValueMount = useCallback( ( fieldId, node ) => {
		setPropertyValueMounts( ( current ) => {
			if ( node ) {
				if ( current[ fieldId ] === node ) {
					return current;
				}
				return { ...current, [ fieldId ]: node };
			}
			if ( ! current[ fieldId ] ) {
				return current;
			}
			const next = { ...current };
			delete next[ fieldId ];
			return next;
		} );
	}, [] );
	const fieldCountLabel = sprintf(
		/* translators: %d: Number of row fields. */
		_n( '%d field', '%d fields', fields.length, 'cortext' ),
		fields.length
	);

	return (
		<div
			className="cortext-row-detail__frame"
			data-properties-visible={ arePropertiesVisible ? 'true' : 'false' }
		>
			<div className="cortext-row-detail__header">
				<div
					className="cortext-row-detail__toolbar"
					role="toolbar"
					aria-label={ __( 'Row detail tools', 'cortext' ) }
				>
					<div className="cortext-row-detail__toolbar-group">
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
							icon={ arePropertiesVisible ? unseen : seen }
							label={
								arePropertiesVisible
									? __( 'Hide fields', 'cortext' )
									: __( 'Show fields', 'cortext' )
							}
							onClick={ () =>
								setArePropertiesVisible(
									( current ) => ! current
								)
							}
						/>
					</div>
					<div className="cortext-row-detail__toolbar-group">
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
							icon={ chevronUp }
							label={ __( 'Row above', 'cortext' ) }
							onClick={ onPrevious }
							disabled={ ! canGoPrevious }
						/>
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
							icon={ chevronDown }
							label={ __( 'Row below', 'cortext' ) }
							onClick={ onNext }
							disabled={ ! canGoNext }
						/>
					</div>
					<div className="cortext-row-detail__toolbar-group">
						<ModeControl
							mode={ mode }
							onChangeMode={ onModeChange }
						/>
					</div>
					<div className="cortext-row-detail__toolbar-group cortext-row-detail__toolbar-group--end">
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--close"
							icon={ closeSmall }
							label={ __( 'Close', 'cortext' ) }
							onClick={ onClose }
						/>
					</div>
				</div>
				<div className="cortext-row-detail__identity">
					<div
						className="cortext-row-detail__title-slot"
						ref={ setTitleMountNode }
					>
						{ ! titleMountNode ? (
							<h2 className="cortext-row-detail__title">
								{ title || __( 'Untitled', 'cortext' ) }
							</h2>
						) : null }
					</div>
				</div>
			</div>
			{ saveError ? (
				<Notice
					className="cortext-row-detail__notice"
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Retry', 'cortext' ),
							onClick: onRetryPending,
							variant: 'primary',
						},
						{
							label: __( 'Discard', 'cortext' ),
							onClick: onDiscardPending,
							variant: 'tertiary',
						},
					] }
				>
					{ saveError }
				</Notice>
			) : null }
			<DetailBody
				arePropertiesVisible={ arePropertiesVisible }
				fields={ fields }
				fieldCountLabel={ fieldCountLabel }
				onValueMount={ setPropertyValueMount }
			>
				{ children( { propertyValueMounts, titleMountNode } ) }
			</DetailBody>
		</div>
	);
}

function LoadingDetail( { onClose } ) {
	return (
		<div className="cortext-row-detail__frame">
			<div className="cortext-row-detail__header">
				<Spinner />
				<Button
					icon={ closeSmall }
					label={ __( 'Close', 'cortext' ) }
					size="compact"
					onClick={ onClose }
				/>
			</div>
		</div>
	);
}

export default function RowDetailView( {
	canGoNext,
	canGoPrevious,
	fields,
	mode,
	onApi,
	onClose,
	onDiscardPending,
	onModeChange,
	onNext,
	onPrevious,
	onRetryPending,
	onSaved,
	postType,
	row,
	rowId,
	saveError,
} ) {
	const { record } = useEntityRecord( 'postType', postType, rowId ?? 0, {
		enabled: Boolean( postType && rowId ),
	} );
	const normalizedMode = getRowDetailMode( { rowDetailMode: mode } );
	const [ isModalClosing, setIsModalClosing ] = useState( false );
	const targetDetail = useMemo( () => {
		if (
			! record ||
			! postType ||
			! rowId ||
			String( record.id ) !== String( rowId )
		) {
			return null;
		}
		return { postType, record, row, rowId };
	}, [ postType, record, row, rowId ] );
	const [ resolvedDetail, setResolvedDetail ] = useState( targetDetail );

	useEffect( () => {
		if ( targetDetail ) {
			setResolvedDetail( targetDetail );
		}
	}, [ targetDetail ] );

	useEffect( () => {
		if ( normalizedMode !== 'modal' ) {
			setIsModalClosing( false );
		}
	}, [ normalizedMode ] );

	const activeDetail =
		targetDetail ??
		( resolvedDetail?.postType === postType ? resolvedDetail : null );
	const activeDetailKey = detailKeyFor( activeDetail );
	const [ arePropertiesVisible, setArePropertiesVisible ] = useState( true );
	const [ displayTitle, setDisplayTitle ] = useState( () =>
		titleFromDetail( activeDetail )
	);
	const [ detailPanes, setDetailPanes ] = useState( () =>
		activeDetail && activeDetailKey
			? [
					{
						key: activeDetailKey,
						detail: activeDetail,
						state: 'active',
					},
			  ]
			: []
	);
	const propertyFields = useMemo(
		() => fields.filter( ( field ) => field.id !== TITLE_FIELD_ID ),
		[ fields ]
	);

	useEffect( () => {
		if ( activeDetail ) {
			setDisplayTitle( titleFromDetail( activeDetail ) );
		}
	}, [ activeDetail ] );

	useEffect( () => {
		if ( ! activeDetail || ! activeDetailKey ) {
			setDetailPanes( [] );
			return;
		}

		setDetailPanes( ( current ) => {
			if ( current.some( ( pane ) => pane.key === activeDetailKey ) ) {
				return current
					.filter(
						( pane ) =>
							pane.key === activeDetailKey ||
							pane.state !== 'preparing'
					)
					.map( ( pane ) => {
						if ( pane.key !== activeDetailKey ) {
							return pane;
						}
						return {
							...pane,
							detail: activeDetail,
							state:
								pane.state === 'covered'
									? 'entering'
									: pane.state,
						};
					} );
			}

			const visiblePanes = current
				.filter(
					( pane ) =>
						pane.state === 'active' || pane.state === 'entering'
				)
				.map( ( pane ) => ( { ...pane, state: 'active' } ) );

			return [
				...visiblePanes,
				{
					key: activeDetailKey,
					detail: activeDetail,
					state: visiblePanes.length ? 'preparing' : 'active',
				},
			];
		} );
	}, [ activeDetail, activeDetailKey ] );

	const onPaneReady = useCallback( ( readyKey ) => {
		setDetailPanes( ( current ) => {
			const readyPane = current.find( ( pane ) => pane.key === readyKey );
			if ( ! readyPane || readyPane.state !== 'preparing' ) {
				return current;
			}

			return current
				.filter(
					( pane ) =>
						pane.key === readyKey || pane.state !== 'preparing'
				)
				.map( ( pane ) => {
					if ( pane.key === readyKey ) {
						return { ...pane, state: 'entering' };
					}
					if (
						pane.state === 'active' ||
						pane.state === 'entering'
					) {
						return { ...pane, state: 'covered' };
					}
					return pane;
				} );
		} );
	}, [] );

	const onPaneAnimationEnd = useCallback( ( event ) => {
		if ( event.target !== event.currentTarget ) {
			return;
		}
		setDetailPanes( settleDetailPanes );
	}, [] );

	useEffect( () => {
		const isTransitioning = detailPanes.some(
			( pane ) => pane.state === 'entering'
		);
		if ( ! isTransitioning ) {
			return undefined;
		}
		if ( prefersReducedMotion() ) {
			setDetailPanes( settleDetailPanes );
			return undefined;
		}

		const timeout = setTimeout( () => {
			setDetailPanes( settleDetailPanes );
		}, ROW_DETAIL_SWITCH_FALLBACK_MS );
		return () => clearTimeout( timeout );
	}, [ detailPanes ] );

	const requestClose = useCallback( async () => {
		if ( normalizedMode !== 'modal' ) {
			return onClose?.();
		}
		if ( isModalClosing ) {
			return false;
		}
		if ( prefersReducedMotion() ) {
			return onClose?.();
		}

		setIsModalClosing( true );
		await delay( ROW_DETAIL_MODAL_CLOSE_MS );
		const didClose = await onClose?.();
		if ( didClose === false ) {
			setIsModalClosing( false );
		}
		return didClose;
	}, [ isModalClosing, normalizedMode, onClose ] );
	const requestNativeModalClose = useCallback(
		() => onClose?.(),
		[ onClose ]
	);
	const activePane = detailPanes.find(
		( pane ) => pane.key === activeDetailKey
	);
	const canUseRowControls = Boolean(
		activeDetail &&
			activePane &&
			activePane.state !== 'preparing' &&
			activePane.state !== 'covered' &&
			String( activeDetail.rowId ) === String( rowId )
	);

	const content =
		! activeDetail && detailPanes.length === 0 ? (
			<LoadingDetail onClose={ requestClose } />
		) : (
			<DetailShell
				arePropertiesVisible={ arePropertiesVisible }
				canGoNext={ canUseRowControls && canGoNext }
				canGoPrevious={ canUseRowControls && canGoPrevious }
				fields={ propertyFields }
				mode={ normalizedMode }
				onClose={ requestClose }
				onDiscardPending={ onDiscardPending }
				onModeChange={ onModeChange }
				onNext={ onNext }
				onPrevious={ onPrevious }
				onRetryPending={ onRetryPending }
				saveError={ canUseRowControls ? saveError : null }
				setArePropertiesVisible={ setArePropertiesVisible }
				title={ displayTitle }
			>
				{ ( { propertyValueMounts, titleMountNode } ) => (
					<div className="cortext-row-detail__pane-stack">
						{ detailPanes.map( ( pane ) => {
							const isCurrentPane =
								pane.key === activeDetailKey &&
								( pane.state === 'active' ||
									pane.state === 'entering' );
							const isHiddenPane =
								pane.state === 'preparing' ||
								pane.state === 'covered';
							const isApiActive = isCurrentPane && ! isHiddenPane;
							const isTitleActive =
								! isHiddenPane &&
								( pane.state === 'active' ||
									pane.state === 'entering' );
							const paneRow = {
								...( pane.detail.row ?? {} ),
								...pane.detail.record,
								title:
									pane.detail.record.title ??
									pane.detail.row?.title,
								meta:
									pane.detail.record.meta ??
									pane.detail.row?.meta,
							};

							return (
								<div
									key={ pane.key }
									className="cortext-row-detail__pane"
									data-state={ pane.state }
									data-interactive={
										isApiActive ? 'true' : 'false'
									}
									aria-hidden={
										isHiddenPane ? true : undefined
									}
									{ ...( isHiddenPane ? { inert: '' } : {} ) }
									onAnimationEnd={ onPaneAnimationEnd }
								>
									<EditorProvider
										post={ pane.detail.record }
										settings={
											window.cortextEditorSettings ?? {}
										}
									>
										<DetailReadySignal
											detailKey={ pane.key }
											onReady={ onPaneReady }
										/>
										<DetailPaneContent
											fields={ propertyFields }
											isActive={ isApiActive }
											isHidden={ isHiddenPane }
											isTitleActive={ isTitleActive }
											onApi={ onApi }
											onSaved={ onSaved }
											onTitle={ setDisplayTitle }
											propertyValueMounts={
												propertyValueMounts
											}
											row={ paneRow }
											state={ pane.state }
											titleMountNode={ titleMountNode }
										/>
									</EditorProvider>
								</div>
							);
						} ) }
					</div>
				) }
			</DetailShell>
		);

	if ( normalizedMode === 'modal' ) {
		return (
			<Modal
				className={
					'cortext-row-detail-modal' +
					( isModalClosing
						? ' cortext-row-detail-modal--closing'
						: '' )
				}
				title={ __( 'Row detail', 'cortext' ) }
				overlayClassName={
					isModalClosing ? 'is-animating-out' : undefined
				}
				onRequestClose={ requestNativeModalClose }
				__experimentalHideHeader
			>
				<div className="cortext-row-detail cortext-row-detail--modal">
					{ content }
				</div>
			</Modal>
		);
	}

	return (
		<div
			className={ `cortext-row-detail cortext-row-detail--${ normalizedMode }` }
			role="dialog"
			aria-label={ __( 'Row detail', 'cortext' ) }
		>
			{ content }
		</div>
	);
}
