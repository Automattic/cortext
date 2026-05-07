import { __ } from '@wordpress/i18n';
import {
	Button,
	CheckboxControl,
	DateTimePicker,
	Dropdown,
	Notice,
	Popover,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalNumberControl as NumberControl,
	TextControl,
} from '@wordpress/components';
import { getSettings } from '@wordpress/date';
import {
	createContext,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { Icon, check } from '@wordpress/icons';

import MultiselectEdit from './MultiselectEdit';
import Chip from './fields/Chip';
import EditOptionsPopover from './fields/EditOptionsPopover';
import { resolveFormatColor } from './fields/formatColors';
import { toRecordId } from '../hooks/fieldIds';
import RelationEditor from './relations/RelationEditor';
import RelationReferences from './relations/RelationReferences';

// Resolves the WordPress site locale into a BCP 47 tag for Intl. WP
// stores locales as `en_US` / `de_DE`; Intl expects `en-US` / `de-DE`.
// All cell-level number and date formatting routes through this so a
// single site renders identically for every viewer (matching how WP
// formats dates server-side via `dateI18n`).
function siteLocale() {
	const wpLocale = getSettings()?.l10n?.locale;
	if ( ! wpLocale ) {
		return undefined;
	}
	return wpLocale.replace( '_', '-' );
}

// tech-debt.md#1: DataViews v6 has no inline cell editing in any layout,
// so we mount this component from `field.render` (a display renderer in
// the docs) and treat the click-to-edit + commit/cancel state as our own.
// tech-debt.md#2: the save callback comes through context because
// `field.render` only receives `{ item }`. Once rows live in core-data
// the cell could call `saveEntityRecord` directly.
export const RowMutationContext = createContext( {
	saveRowField: null,
	// `{ rowId, fieldId }` of the cell that should pop into edit mode.
	// Set by the parent when a new row is created (open the title) or
	// when Tab navigation hops between cells.
	editRequest: null,
	clearEditRequest: () => {},
	// Asks the parent to set editRequest to the next/prev editable cell.
	// `direction` is 1 for Tab, -1 for Shift+Tab.
	requestNext: () => {},
	optionOverrides: {},
	updateFieldOptions: () => {},
	refreshRows: () => {},
} );

const TEXT_INPUT_TYPES = new Set( [ 'text', 'email', 'url', 'number' ] );
const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_PREFIX_PATTERN = /^(\d{4}-\d{2}-\d{2})(?:T|$)/;

export function dateOnlyValue( value ) {
	if ( value === null || value === undefined || value === '' ) {
		return value;
	}
	const text = String( value );
	return DATE_PREFIX_PATTERN.exec( text )?.[ 1 ] ?? text;
}

function FieldError( { message } ) {
	if ( ! message ) {
		return null;
	}

	return (
		<Notice
			className="cortext-editable-cell__error"
			status="error"
			isDismissible={ false }
		>
			{ message }
		</Notice>
	);
}

// Conservative URL probe: only treat values as links when they parse as
// http(s) URLs. Anything else (relative paths, mailto:, plain strings) is
// rendered as text so we never produce a broken link.
const URL_PATTERN = /^https?:\/\//i;

// Clamp decimals to a sane range; Intl.NumberFormat throws above 100.
function clampDecimals( decimals ) {
	const d = Number( decimals );
	if ( ! Number.isFinite( d ) ) {
		return 0;
	}
	return Math.min( 6, Math.max( 0, Math.trunc( d ) ) );
}

// Formats a number value per a stored `number_format` config. Returns
// `String(value)` for non-numeric values so editing partial input ("3.")
// or stale string values doesn't blow up the cell. Only forces a fixed
// decimal count when the user explicitly picks one — otherwise we let
// Intl decide, so a field with no saved format still shows `1.25` as
// `1.25` rather than truncating it to `1`.
export function formatNumberValue( value, format ) {
	const num = typeof value === 'number' ? value : Number( value );
	if ( ! Number.isFinite( num ) ) {
		return String( value );
	}
	const style = format?.style ?? 'plain';
	const hasDecimals =
		format?.decimals !== undefined && format?.decimals !== null;
	const fractionOpts = hasDecimals
		? {
				minimumFractionDigits: clampDecimals( format.decimals ),
				maximumFractionDigits: clampDecimals( format.decimals ),
		  }
		: {};
	const locale = siteLocale();
	try {
		if ( style === 'percent' ) {
			return new Intl.NumberFormat( locale, {
				style: 'percent',
				...fractionOpts,
			} ).format( num );
		}
		if ( style === 'currency' ) {
			return new Intl.NumberFormat( locale, {
				style: 'currency',
				currency: format?.currency || 'USD',
				...fractionOpts,
			} ).format( num );
		}
		return new Intl.NumberFormat( locale, {
			useGrouping: style === 'comma',
			...fractionOpts,
		} ).format( num );
	} catch {
		return String( num );
	}
}

// Formats a date / datetime value per a stored `date_format` config.
// Returns `String(value)` for unparseable input so the cell still shows
// something rather than going blank on bad data.
export function formatDateValue( value, type, format ) {
	const style = format?.style ?? 'locale';
	const showTime = format?.time ?? type === 'datetime';
	const hour12 = format?.hour12 ?? true;
	let locale;
	if ( style === 'us' ) {
		locale = 'en-US';
	} else if ( style === 'eu' ) {
		locale = 'en-GB';
	} else {
		locale = siteLocale();
	}

	// Date-only input (YYYY-MM-DD) builds a local-midnight Date so the
	// calendar day is preserved across time zones. The default `Date`
	// parser would treat it as UTC and shift the day west of GMT.
	if ( type === 'date' ) {
		const match = DATE_ONLY_PATTERN.exec( String( value ) );
		if ( match ) {
			const [ , y, m, d ] = match;
			const date = new Date( Number( y ), Number( m ) - 1, Number( d ) );
			return new Intl.DateTimeFormat( locale, {
				year: 'numeric',
				month: '2-digit',
				day: '2-digit',
			} ).format( date );
		}
	}

	const date = new Date( value );
	if ( Number.isNaN( date.getTime() ) ) {
		return String( value );
	}

	const options = {
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
	};
	if ( showTime ) {
		options.hour = '2-digit';
		options.minute = '2-digit';
		options.hour12 = hour12;
	}
	return new Intl.DateTimeFormat( locale, options ).format( date );
}

// Maps a numeric value to a 0..1 fill ratio for the bar/ring visuals.
// Percent fields are treated as 0..1 directly; everything else is
// divided by `format.divideBy` (default 100). Out-of-range values clamp,
// so a value beyond the configured max simply pegs the visual at full.
function fillRatio( value, format ) {
	const num = typeof value === 'number' ? value : Number( value );
	if ( ! Number.isFinite( num ) ) {
		return 0;
	}
	if ( format?.style === 'percent' ) {
		return Math.min( 1, Math.max( 0, num ) );
	}
	const divisor = Number( format?.divideBy );
	const safeDivisor =
		Number.isFinite( divisor ) && divisor > 0 ? divisor : 100;
	return Math.min( 1, Math.max( 0, num / safeDivisor ) );
}

function fillStyle( format ) {
	const hex = resolveFormatColor( format?.color );
	return hex ? { background: hex } : undefined;
}

function strokeStyle( format ) {
	const hex = resolveFormatColor( format?.color );
	return hex ? { stroke: hex } : undefined;
}

function NumberBar( { value, format, text } ) {
	const ratio = fillRatio( value, format );
	const showNumber = format?.showNumber !== false;
	return (
		<span className="cortext-cell-bar" title={ text }>
			<span className="cortext-cell-bar__track">
				<span
					className="cortext-cell-bar__fill"
					style={ {
						width: `${ ratio * 100 }%`,
						...fillStyle( format ),
					} }
				/>
			</span>
			{ showNumber ? (
				<span className="cortext-cell-bar__label">{ text }</span>
			) : null }
		</span>
	);
}

function NumberRing( { value, format, text } ) {
	const ratio = fillRatio( value, format );
	const showNumber = format?.showNumber !== false;
	const circumference = 2 * Math.PI * 7;
	return (
		<span className="cortext-cell-ring" title={ text }>
			<svg
				className="cortext-cell-ring__svg"
				viewBox="0 0 20 20"
				aria-hidden="true"
			>
				<circle
					cx="10"
					cy="10"
					r="7"
					fill="none"
					strokeWidth="2.5"
					className="cortext-cell-ring__track"
				/>
				<circle
					cx="10"
					cy="10"
					r="7"
					fill="none"
					strokeWidth="2.5"
					className="cortext-cell-ring__fill"
					style={ strokeStyle( format ) }
					strokeDasharray={ circumference }
					strokeDashoffset={ circumference * ( 1 - ratio ) }
					transform="rotate(-90 10 10)"
				/>
			</svg>
			{ showNumber ? (
				<span className="cortext-cell-ring__label">{ text }</span>
			) : null }
		</span>
	);
}

// Returns either '' (empty cell) or a renderable value (string or JSX).
// `display === ''` is the consumer's empty-cell signal — see CellShell's
// `isEmpty` prop. Non-empty values may be JSX (anchor for url, icon for
// checkbox, chip(s) for select / multiselect).
//
// Third arg is a bag of optional rendering hints: `elements` for select
// chips, `format` for number / date config. Both are field-level and
// constant across rows, so callers pass them once via the render prop.
export function formatDisplay( value, type, options = {} ) {
	const { elements, format } = options;
	if ( value === null || value === undefined || value === '' ) {
		return '';
	}

	if ( type === 'checkbox' ) {
		// `false` is a meaningful value but renders as a blank cell.
		// Reaching this branch is rare in practice (interactive checkbox
		// cells skip formatDisplay entirely; this only fires for read-only
		// checkbox columns).
		if ( ! value ) {
			return '';
		}
		return <Icon icon={ check } className="cortext-cell-check" />;
	}

	if ( type === 'url' ) {
		const text = String( value ).trim();
		if ( ! URL_PATTERN.test( text ) ) {
			return text;
		}
		return (
			<a
				href={ text }
				target="_blank"
				rel="noopener noreferrer"
				className="cortext-cell-link"
				onClick={ ( event ) => event.stopPropagation() }
			>
				{ text }
			</a>
		);
	}

	if ( type === 'select' ) {
		const single = Array.isArray( value ) ? value[ 0 ] : value;
		if ( single === null || single === undefined || single === '' ) {
			return '';
		}
		const element = elements?.find( ( e ) => e.value === single );
		return (
			<Chip
				label={ element?.label ?? String( single ) }
				color={ element?.color }
			/>
		);
	}

	if ( type === 'multiselect' ) {
		const list = Array.isArray( value ) ? value : [ value ];
		const populated = list.filter(
			( v ) => v !== null && v !== undefined && v !== ''
		);
		if ( populated.length === 0 ) {
			return '';
		}
		return (
			<span className="cortext-chips">
				{ populated.map( ( v ) => {
					const element = elements?.find( ( e ) => e.value === v );
					return (
						<Chip
							key={ v }
							label={ element?.label ?? String( v ) }
							color={ element?.color }
						/>
					);
				} ) }
			</span>
		);
	}

	if ( type === 'relation' ) {
		return <RelationReferences value={ value } />;
	}

	if ( type === 'date' || type === 'datetime' ) {
		return formatDateValue( value, type, format );
	}

	if ( type === 'number' ) {
		const text = formatNumberValue( value, format );
		if ( format?.display === 'bar' ) {
			return (
				<NumberBar value={ value } format={ format } text={ text } />
			);
		}
		if ( format?.display === 'ring' ) {
			return (
				<NumberRing value={ value } format={ format } text={ text } />
			);
		}
		return text;
	}

	return String( value );
}

function CellShell( { children, onActivate, ariaLabel, className, disabled } ) {
	// Plain-text content gets the ellipsis wrapper so narrow columns
	// truncate cleanly. JSX content (chips, links, icons) carries its own
	// truncation/wrap rules and renders directly — putting `white-space:
	// nowrap` above `flex-wrap: wrap` chips made multiselect cells overflow
	// into adjacent columns.
	const isText = typeof children === 'string';
	return (
		<div
			role={ disabled ? undefined : 'button' }
			tabIndex={ disabled ? -1 : 0 }
			className={ className }
			onClick={ disabled ? undefined : onActivate }
			onKeyDown={
				disabled
					? undefined
					: ( event ) => {
							if ( event.key === 'Enter' || event.key === ' ' ) {
								event.preventDefault();
								onActivate();
							}
					  }
			}
			aria-label={ ariaLabel }
			aria-hidden={ disabled }
		>
			{ isText ? (
				<span className="cortext-editable-cell__display">
					{ children }
				</span>
			) : (
				children
			) }
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
	onTab,
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

	// `commit` returns the saveRowField promise (resolving to a truthy
	// value on success, falsy on failure) so the keyboard handler can
	// only chase Tab to the next cell once the current one persisted.
	const commit = () => {
		const next = type === 'number' ? toCommittedNumber( local ) : local;
		return onCommit( next );
	};

	const handleKeyDown = async ( event ) => {
		if ( event.key === 'Enter' ) {
			event.preventDefault();
			await commit();
		} else if ( event.key === 'Escape' ) {
			event.preventDefault();
			onCancel();
		} else if ( event.key === 'Tab' && onTab ) {
			event.preventDefault();
			const direction = event.shiftKey ? -1 : 1;
			const ok = await commit();
			if ( ok ) {
				onTab( direction );
			}
		}
	};

	if ( type === 'number' ) {
		// `spinControls="none"` drops both NumberControl's custom spin
		// buttons (the default "custom" mode renders them as a suffix
		// inside the input, which widens the cell on focus) and the
		// browser's native arrows. Keyboard arrow keys still work.
		return (
			<NumberControl
				ref={ inputRef }
				value={ local ?? '' }
				onChange={ ( next ) => setLocal( next ?? '' ) }
				onBlur={ commit }
				onKeyDown={ handleKeyDown }
				spinControls="none"
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

// Cell-side select editor: a button trigger plus a controlled `Popover`
// hosting the unified `EditOptionsPopover` in pick mode. We use a
// controlled Popover (rather than `Dropdown`) so the editor's lifetime
// is owned by the cell's `isEditing` flag — option mutations cause the
// entity store to refetch and re-render the cell, and `Dropdown`'s
// outside-click heuristics could close everything mid-interaction
// (creating an option, picking a color in the per-option submenu).
// `Popover` here lets the parent unmount it explicitly when editing
// ends, while still closing on outside click + Escape via `onClose`.
function SelectEditor( {
	value,
	elements,
	onCommit,
	onOptionsSaved,
	onRowsChanged,
	onRequestClose,
	onCancel,
	onTab,
	recordId,
	label,
} ) {
	const [ anchor, setAnchor ] = useState( null );
	const items = useMemo( () => elements ?? [], [ elements ] );
	const labelFor = useMemo( () => {
		const map = new Map( items.map( ( e ) => [ e.value, e.label ] ) );
		return ( v ) => map.get( v ) ?? v;
	}, [ items ] );

	const hasValue = value !== null && value !== undefined && value !== '';
	const currentChip = hasValue
		? items.find( ( e ) => e.value === value )
		: null;
	const triggerContent = hasValue ? (
		<Chip
			label={ currentChip?.label ?? labelFor( value ) }
			color={ currentChip?.color }
		/>
	) : (
		<span className="cortext-select-edit__placeholder">
			{ __( 'Select…', 'cortext' ) }
		</span>
	);

	const handleTriggerKeyDown = ( event ) => {
		if ( event.key === 'Tab' && onTab ) {
			event.preventDefault();
			onTab( event.shiftKey ? -1 : 1 );
		}
	};

	return (
		<>
			<Button
				ref={ setAnchor }
				variant="tertiary"
				className="cortext-select-edit__toggle"
				onKeyDown={ handleTriggerKeyDown }
				aria-expanded
				aria-label={ label }
			>
				{ triggerContent }
			</Button>
			{ anchor ? (
				<Popover
					anchor={ anchor }
					placement="bottom-start"
					onClose={ onCancel }
					focusOnMount="firstElement"
				>
					<EditOptionsPopover
						recordId={ recordId }
						fieldType="select"
						initialOptions={ items }
						value={ value }
						onOptionsSaved={ onOptionsSaved }
						onRowsChanged={ onRowsChanged }
						onRequestClose={ onRequestClose }
						onPick={ async ( next ) => {
							await onCommit( next );
							onCancel();
						} }
					/>
				</Popover>
			) : null }
		</>
	);
}

function DateEditor( { value, type, format, onCommit, onCancel, label } ) {
	return (
		<Dropdown
			defaultOpen
			onClose={ onCancel }
			renderToggle={ ( { isOpen, onToggle } ) => (
				<Button
					variant="tertiary"
					className="cortext-date-edit__toggle"
					onClick={ onToggle }
					aria-expanded={ isOpen }
				>
					{ value
						? formatDisplay( value, type, { format } )
						: __( 'Pick a date…', 'cortext' ) }
				</Button>
			) }
			renderContent={ ( { onClose } ) => (
				<div className="cortext-editable-cell__date">
					<DateTimePicker
						currentDate={ value || null }
						onChange={ async ( next ) => {
							const didSave = await onCommit(
								type === 'date' ? dateOnlyValue( next ) : next
							);
							if ( didSave ) {
								onClose();
							}
						} }
						is12Hour={ format?.hour12 ?? true }
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
	format,
	relation,
	label,
	getValue,
	readOnly = false,
} ) {
	const {
		saveRowField,
		editRequest,
		clearEditRequest,
		requestNext,
		optionOverrides,
		updateFieldOptions,
		refreshRows,
	} = useContext( RowMutationContext );
	const [ isEditing, setIsEditing ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const checkboxRef = useRef( null );

	const rowId = item?.id;
	const value = getValue
		? getValue( { item } )
		: item?.meta?.[ fieldId ] ?? null;
	const effectiveElements = optionOverrides?.[ fieldId ] ?? elements;
	const display = formatDisplay( value, fieldType, {
		elements: effectiveElements,
		format,
		relation,
	} );

	// Open this cell when the parent targets it via editRequest (new-row
	// title auto-open, Tab navigation, etc.), then clear the request so
	// subsequent renders don't reopen. Checkbox has no edit/display state
	// distinction; "opening" it just means focusing the underlying input.
	useEffect( () => {
		const targeted =
			rowId &&
			editRequest?.rowId === rowId &&
			editRequest?.fieldId === fieldId &&
			! readOnly &&
			saveRowField;
		if ( ! targeted ) {
			return;
		}
		if ( fieldType === 'checkbox' ) {
			const input = checkboxRef.current?.querySelector(
				'input[type="checkbox"]'
			);
			input?.focus();
			clearEditRequest?.();
		} else if ( ! isEditing ) {
			setIsEditing( true );
			clearEditRequest?.();
		}
	}, [
		fieldId,
		rowId,
		editRequest,
		isEditing,
		readOnly,
		saveRowField,
		fieldType,
		clearEditRequest,
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
			return true;
		}
		setIsSaving( true );
		setError( null );
		try {
			await saveRowField( rowId, fieldId, next );
			closeEditor();
			return true;
		} catch ( err ) {
			setError( err?.message ?? __( 'Could not save.', 'cortext' ) );
			setIsSaving( false );
			return false;
		}
	};

	// Checkbox: direct toggle, no click-to-edit step. The ref + onKeyDown
	// on the wrapper give Tab navigation a place to focus into and out of.
	if ( fieldType === 'checkbox' ) {
		const handleCheckboxKeyDown = ( event ) => {
			if ( event.key === 'Tab' && requestNext ) {
				event.preventDefault();
				requestNext( rowId, fieldId, event.shiftKey ? -1 : 1 );
			}
		};
		return (
			// eslint-disable-next-line jsx-a11y/no-static-element-interactions
			<div
				ref={ checkboxRef }
				onKeyDown={ handleCheckboxKeyDown }
				className="cortext-cell-checkbox"
			>
				<CheckboxControl
					checked={ Boolean( value ) }
					onChange={ ( next ) => commit( next ) }
					disabled={ isSaving }
					// tech-debt.md#8: CheckboxControl renders its `label`
					// prop visibly regardless of hideLabelFromVision, so we
					// pass aria-label to keep screen readers labelled
					// without doubling the column header text.
					aria-label={ label }
					__nextHasNoMarginBottom
				/>
				<FieldError message={ error } />
			</div>
		);
	}

	let editor = null;
	if ( isEditing ) {
		if ( fieldType === 'multiselect' ) {
			// Multiselect persists on each toggle (Notion-style: no Save
			// button). Wire onSave straight to saveRowField so saving
			// doesn't close the cell; closing happens via Dropdown's
			// onClose firing onCancel.
			editor = (
				<MultiselectEdit
					recordId={ toRecordId( fieldId ) }
					value={ Array.isArray( value ) ? value : [] }
					elements={ effectiveElements ?? [] }
					onSave={ ( nextValues ) =>
						saveRowField?.( rowId, fieldId, nextValues )
					}
					onOptionsSaved={ ( nextOptions ) =>
						updateFieldOptions?.(
							toRecordId( fieldId ),
							nextOptions
						)
					}
					onRowsChanged={ refreshRows }
					onRequestClose={ closeEditor }
					onCancel={ closeEditor }
					label={ label }
				/>
			);
		} else if ( fieldType === 'relation' ) {
			editor = (
				<RelationEditor
					value={ Array.isArray( value ) ? value : [] }
					relation={ relation }
					onSave={ ( nextValues ) =>
						saveRowField?.( rowId, fieldId, nextValues )
					}
					onCancel={ closeEditor }
					label={ label }
				/>
			);
		} else if ( fieldType === 'select' ) {
			editor = (
				<SelectEditor
					recordId={ toRecordId( fieldId ) }
					value={ value }
					elements={ effectiveElements }
					onCommit={ commit }
					onOptionsSaved={ ( nextOptions ) =>
						updateFieldOptions?.(
							toRecordId( fieldId ),
							nextOptions
						)
					}
					onRowsChanged={ refreshRows }
					onRequestClose={ closeEditor }
					onCancel={ closeEditor }
					onTab={ ( direction ) =>
						requestNext?.( rowId, fieldId, direction )
					}
					label={ label }
				/>
			);
		} else if ( fieldType === 'date' || fieldType === 'datetime' ) {
			editor = (
				<DateEditor
					value={ value }
					type={ fieldType }
					format={ format }
					onCommit={ commit }
					onCancel={ closeEditor }
					label={ label }
				/>
			);
		} else if (
			TEXT_INPUT_TYPES.has( fieldType ) ||
			fieldType === 'title'
		) {
			editor = (
				<TextLikeEditor
					value={ value ?? '' }
					type={ fieldType === 'title' ? 'text' : fieldType }
					onCommit={ commit }
					onCancel={ closeEditor }
					onTab={ ( direction ) =>
						requestNext?.( rowId, fieldId, direction )
					}
					shouldAutoFocus
					label={ label }
				/>
			);
		}
	}

	// Always render the shell so its content sets the column's intrinsic
	// width. When editing, overlay the editor on top via position:absolute
	// so the column doesn't reflow to the editor's larger min-content.
	const shellClassName =
		'cortext-editable-cell__shell' +
		( display === '' ? ' cortext-editable-cell__shell--empty' : '' );

	return (
		<div
			className={
				'cortext-editable-cell' +
				( isEditing ? ' cortext-editable-cell--editing' : '' )
			}
		>
			<CellShell
				ariaLabel={ label }
				className={ shellClassName }
				disabled={ isEditing }
				onActivate={ () => setIsEditing( true ) }
			>
				{ display }
			</CellShell>
			{ isEditing && editor && (
				<div className="cortext-editable-cell__overlay">
					{ editor }
					<FieldError message={ error } />
				</div>
			) }
		</div>
	);
}
