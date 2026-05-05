import { BlockCanvas, BlockList, useSettings } from '@wordpress/block-editor';
import {
	Button,
	CheckboxControl,
	DateTimePicker,
	Dropdown,
	FormTokenField,
	MenuGroup,
	MenuItem,
	Modal,
	Notice,
	Spinner,
} from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { EditorProvider, store as editorStore } from '@wordpress/editor';
import {
	useCallback,
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
	details,
	drawerRight,
	fullscreen,
	square,
} from '@wordpress/icons';

import useAutosave from '../hooks/useAutosave';
import { dateOnlyValue, formatDisplay } from './EditableCell';
import { TITLE_FIELD_ID } from './dataViewColumns';
import { getRowDetailMode, splitPropertyPatch } from './rowDetailUtils';

export const ROW_DETAIL_MODE_ICONS = {
	side: drawerRight,
	modal: square,
	full: fullscreen,
};

const ROW_DETAIL_MODE_LABELS = {
	side: __( 'Side peek', 'cortext' ),
	modal: __( 'Center modal', 'cortext' ),
	full: __( 'Full page', 'cortext' ),
};

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

function RowAutosaveBridge( { onApi, onSaved } ) {
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
		onApi?.( { flushNow, discard, hasPendingEdits } );
		return () => onApi?.( null );
	}, [ discard, flushNow, hasPendingEdits, onApi ] );

	useEffect( () => {
		if ( status === 'saved' ) {
			onSaved?.();
		}
	}, [ onSaved, status ] );

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
	return <span className="cortext-row-detail__empty-value">Empty</span>;
}

function ReadOnlyProperty( { value, type, elements, format } ) {
	const display = formatDisplay( value, type, { elements, format } );
	return (
		<div className="cortext-row-detail__readonly">
			{ display === '' ? emptyLabel() : display }
		</div>
	);
}

function labelForElementValue( elements, value ) {
	const match = ( elements ?? [] ).find( ( element ) => {
		return String( element.value ) === String( value );
	} );
	return match?.label ?? value;
}

function SelectPropertyControl( { field, value, elements, onChange } ) {
	const hasValue = value !== null && value !== undefined && value !== '';
	const triggerLabel = hasValue
		? labelForElementValue( elements, value )
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
					{ triggerLabel }
				</Button>
			) }
			renderContent={ ( { onClose } ) => (
				<MenuGroup>
					<MenuItem
						isSelected={ ! hasValue }
						onClick={ () => {
							onChange( null );
							onClose();
						} }
					>
						{ __( 'Empty', 'cortext' ) }
					</MenuItem>
					{ ( elements ?? [] ).map( ( element ) => (
						<MenuItem
							key={ element.value }
							isSelected={
								String( element.value ) === String( value )
							}
							onClick={ () => {
								onChange( element.value );
								onClose();
							} }
						>
							{ element.label }
						</MenuItem>
					) ) }
				</MenuGroup>
			) }
		/>
	);
}

function MultiselectPropertyControl( { field, value, elements, onChange } ) {
	const valueToLabel = useMemo( () => {
		const map = new Map();
		( elements ?? [] ).forEach( ( element ) =>
			map.set( element.value, element.label )
		);
		return map;
	}, [ elements ] );
	const labelToValue = useMemo( () => {
		const map = new Map();
		( elements ?? [] ).forEach( ( element ) =>
			map.set( element.label, element.value )
		);
		return map;
	}, [ elements ] );
	const tokens = useMemo(
		() =>
			( Array.isArray( value ) ? value : [] ).map(
				( item ) => valueToLabel.get( item ) ?? String( item )
			),
		[ value, valueToLabel ]
	);
	const suggestions = useMemo(
		() => ( elements ?? [] ).map( ( element ) => element.label ),
		[ elements ]
	);
	const triggerLabel = tokens.length
		? tokens.join( ', ' )
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
					{ triggerLabel }
				</Button>
			) }
			renderContent={ () => (
				<div className="cortext-row-detail__tokens-popover">
					<FormTokenField
						value={ tokens }
						suggestions={ suggestions }
						onChange={ ( nextTokens ) => {
							onChange(
								nextTokens
									.map(
										( token ) =>
											labelToValue.get( token ) ?? token
									)
									.filter(
										( next ) =>
											next !== '' &&
											next !== null &&
											next !== undefined
									)
							);
						} }
						label={ field.label }
						__experimentalExpandOnFocus
						__experimentalShowHowTo={ false }
						__nextHasNoMarginBottom
					/>
				</div>
			) }
		/>
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
	const ref = useRef( null );
	const textValue =
		value === null || value === undefined ? '' : String( value );

	useEffect( () => {
		const ownerDocument = ref.current?.ownerDocument;
		if (
			ref.current &&
			ownerDocument?.activeElement !== ref.current &&
			ref.current.textContent !== textValue
		) {
			ref.current.textContent = textValue;
		}
	}, [ textValue ] );

	return (
		<div
			ref={ ref }
			aria-label={ label }
			className="cortext-row-detail__property-editable-text"
			contentEditable
			data-placeholder={ __( 'Empty', 'cortext' ) }
			inputMode={ inputMode }
			role="textbox"
			suppressContentEditableWarning
			tabIndex={ 0 }
			onInput={ ( event ) =>
				onChange( event.currentTarget.textContent ?? '' )
			}
			onKeyDown={ ( event ) => {
				if ( event.key === 'Enter' ) {
					event.preventDefault();
					event.currentTarget.blur();
				}
			} }
		>
			{ textValue }
		</div>
	);
}

function PropertyControl( { field, value, onChange } ) {
	const type = fieldType( field );
	const label = field.label;
	const elements = field.cortextElements ?? field.elements ?? [];

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
			<EditablePropertyText
				label={ label }
				inputMode="decimal"
				value={ value ?? '' }
				onChange={ ( next ) =>
					onChange(
						next === '' || next === null || next === undefined
							? null
							: Number( next )
					)
				}
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

function RowPropertyForm( { fields, row } ) {
	const { editPost } = useDispatch( editorStore );
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
		<div className="cortext-row-detail__properties">
			{ fields.map( ( field ) => {
				const value = valueForField( field, data );
				const type = fieldType( field );
				const isEditable =
					field.id === TITLE_FIELD_ID ||
					( field.editable && field.id?.startsWith?.( 'field-' ) );

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
							{ isEditable ? (
								<PropertyControl
									field={ field }
									value={ value }
									onChange={ ( next ) =>
										update( { [ field.id ]: next } )
									}
								/>
							) : (
								<ReadOnlyProperty
									value={ value }
									type={ type }
									elements={
										field.cortextElements ?? field.elements
									}
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

function DetailFrame( {
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
	row,
	saveError,
	canGoNext,
	canGoPrevious,
} ) {
	const editedTitle = useSelect(
		( select ) => select( editorStore ).getEditedPostAttribute( 'title' ),
		[]
	);
	const title =
		typeof editedTitle === 'string'
			? editedTitle
			: row?.title?.raw ?? row?.title?.rendered ?? '';
	const [ arePropertiesVisible, setArePropertiesVisible ] = useState( true );
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
				<RowAutosaveBridge onApi={ onApi } onSaved={ onSaved } />
				<div
					className="cortext-row-detail__toolbar"
					role="toolbar"
					aria-label={ __( 'Row detail tools', 'cortext' ) }
				>
					<div className="cortext-row-detail__toolbar-group">
						<Button
							className="cortext-row-detail__toolbar-button cortext-row-detail__toolbar-button--icon"
							icon={ details }
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
					<h2 className="cortext-row-detail__title">
						{ title || __( 'Untitled', 'cortext' ) }
					</h2>
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
			<div className="cortext-row-detail__body">
				<div
					className="cortext-row-detail__properties-region"
					aria-hidden={ arePropertiesVisible ? undefined : true }
					{ ...( arePropertiesVisible ? {} : { inert: '' } ) }
				>
					<div className="cortext-row-detail__properties-region-inner">
						<RowPropertyForm fields={ fields } row={ row } />
					</div>
				</div>
				<div
					className="cortext-row-detail__fields-indicator-wrap"
					aria-hidden={ arePropertiesVisible ? true : undefined }
					{ ...( arePropertiesVisible ? { inert: '' } : {} ) }
				>
					<div className="cortext-row-detail__fields-indicator-inner">
						<Button
							className="cortext-row-detail__fields-indicator"
							icon={ details }
							label={ sprintf(
								/* translators: %s: Number of hidden fields. */
								__( 'Show %s', 'cortext' ),
								fieldCountLabel
							) }
							variant="tertiary"
							onClick={ () => setArePropertiesVisible( true ) }
						>
							{ fieldCountLabel }
						</Button>
					</div>
				</div>
				<RowContentEditor />
			</div>
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
	const targetDetail = useMemo( () => {
		if ( ! record || ! postType || ! rowId ) {
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

	const activeDetail =
		targetDetail ??
		( resolvedDetail?.postType === postType ? resolvedDetail : null );
	const isSwitchingRows = Boolean(
		activeDetail && String( activeDetail.rowId ) !== String( rowId )
	);

	const content = ! activeDetail ? (
		<LoadingDetail onClose={ onClose } />
	) : (
		<EditorProvider
			key={ `${ activeDetail.postType }:${ activeDetail.rowId }` }
			post={ activeDetail.record }
			settings={ window.cortextEditorSettings ?? {} }
		>
			<DetailFrame
				canGoNext={ ! isSwitchingRows && canGoNext }
				canGoPrevious={ ! isSwitchingRows && canGoPrevious }
				fields={ fields }
				mode={ normalizedMode }
				onApi={ onApi }
				onClose={ onClose }
				onDiscardPending={ onDiscardPending }
				onModeChange={ onModeChange }
				onNext={ onNext }
				onPrevious={ onPrevious }
				onRetryPending={ onRetryPending }
				onSaved={ onSaved }
				row={ {
					...( activeDetail.row ?? {} ),
					...activeDetail.record,
					title: activeDetail.record.title ?? activeDetail.row?.title,
					meta: activeDetail.record.meta ?? activeDetail.row?.meta,
				} }
				saveError={ saveError }
			/>
		</EditorProvider>
	);

	if ( normalizedMode === 'modal' ) {
		return (
			<Modal
				className="cortext-row-detail-modal"
				title={ __( 'Row detail', 'cortext' ) }
				onRequestClose={ onClose }
				__experimentalHideHeader
			>
				{ content }
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
