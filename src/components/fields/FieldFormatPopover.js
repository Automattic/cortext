import { __ } from '@wordpress/i18n';
import {
	Icon,
	Popover,
	ToggleControl,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalNumberControl as NumberControl,
} from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { forwardRef, useMemo, useRef } from '@wordpress/element';
import { check, chevronRight } from '@wordpress/icons';

import { parseFormat } from '../../hooks/fieldMapping';
import { useSubmenuPlacement } from '../../hooks/useSubmenuPlacement';
import { FORMAT_COLORS, findFormatColor } from './formatColors';

const FOCUSABLE_CONTROL_SELECTOR = [
	'button:not(:disabled)',
	'input:not(:disabled):not([type="hidden"])',
	'select:not(:disabled)',
	'textarea:not(:disabled)',
	'[tabindex]:not([tabindex="-1"])',
].join( ',' );

function getFocusableControls( container ) {
	return Array.from(
		container?.querySelectorAll( FOCUSABLE_CONTROL_SELECTOR ) ?? []
	).filter(
		( element ) =>
			! element.closest( '[hidden], [aria-hidden="true"]' ) &&
			element.getAttribute( 'aria-disabled' ) !== 'true'
	);
}

function shouldLetElementHandleArrowKeys( element ) {
	if ( ! element ) {
		return false;
	}
	if ( element.isContentEditable ) {
		return true;
	}
	const tagName = element.tagName;
	if ( tagName === 'TEXTAREA' || tagName === 'SELECT' ) {
		return true;
	}
	if ( tagName !== 'INPUT' ) {
		return false;
	}
	return ! [ 'button', 'checkbox', 'radio', 'reset', 'submit' ].includes(
		element.type
	);
}

function focusRelativeControl( container, activeElement, direction ) {
	const controls = getFocusableControls( container );
	if ( ! controls.length ) {
		return false;
	}
	const currentIndex = controls.includes( activeElement )
		? controls.indexOf( activeElement )
		: -1;
	let nextIndex;
	if ( currentIndex === -1 ) {
		nextIndex = direction > 0 ? 0 : controls.length - 1;
	} else {
		nextIndex =
			( currentIndex + direction + controls.length ) % controls.length;
	}
	controls[ nextIndex ]?.focus();
	return true;
}

function focusEdgeControl( container, edge ) {
	const controls = getFocusableControls( container );
	if ( ! controls.length ) {
		return false;
	}
	const next =
		edge === 'last' ? controls[ controls.length - 1 ] : controls[ 0 ];
	next?.focus();
	return true;
}

function focusRefOnNextFrame( ref ) {
	window.requestAnimationFrame( () => {
		ref.current?.focus();
	} );
}

// Number "format" rows flatten the storage shape (style + currency) into
// a single flat list so the menu stays compact. Each entry carries the
// `style` (and `currency` for the four currency rows) it projects onto
// the persisted `number_format` JSON.
const NUMBER_FORMATS = [
	{ id: 'plain', label: __( 'Number', 'cortext' ), style: 'plain' },
	{
		id: 'comma',
		label: __( 'Number with commas', 'cortext' ),
		style: 'comma',
	},
	{ id: 'percent', label: __( 'Percent', 'cortext' ), style: 'percent' },
	{
		id: 'usd',
		label: __( 'US Dollar (USD)', 'cortext' ),
		style: 'currency',
		currency: 'USD',
	},
	{
		id: 'eur',
		label: __( 'Euro (EUR)', 'cortext' ),
		style: 'currency',
		currency: 'EUR',
	},
	{
		id: 'gbp',
		label: __( 'Pound (GBP)', 'cortext' ),
		style: 'currency',
		currency: 'GBP',
	},
	{
		id: 'jpy',
		label: __( 'Yen (JPY)', 'cortext' ),
		style: 'currency',
		currency: 'JPY',
	},
];

// `value: null` is the "let Intl decide" state; we store no `decimals`
// key on the field meta in that case, so existing data keeps its
// natural precision (e.g. 1.25 stays 1.25 rather than rounding).
const DECIMAL_OPTIONS = [
	{ id: 'default', label: __( 'Default', 'cortext' ), value: null },
	{ id: 'd0', label: '0', value: 0 },
	{ id: 'd1', label: '1', value: 1 },
	{ id: 'd2', label: '2', value: 2 },
	{ id: 'd3', label: '3', value: 3 },
	{ id: 'd4', label: '4', value: 4 },
	{ id: 'd5', label: '5', value: 5 },
	{ id: 'd6', label: '6', value: 6 },
];

const DATE_FORMATS = [
	{ id: 'locale', label: __( 'Locale default', 'cortext' ) },
	{ id: 'us', label: __( 'US (MM/DD/YYYY)', 'cortext' ) },
	{ id: 'eu', label: __( 'EU (DD/MM/YYYY)', 'cortext' ) },
];

const TIME_OPTIONS = [
	{ id: 'off', label: __( 'Off', 'cortext' ), time: false },
	{
		id: '12',
		label: __( '12-hour', 'cortext' ),
		time: true,
		hour12: true,
	},
	{
		id: '24',
		label: __( '24-hour', 'cortext' ),
		time: true,
		hour12: false,
	},
];

function findNumberFormat( config ) {
	if ( ! config?.style || config.style === 'plain' ) {
		return NUMBER_FORMATS[ 0 ];
	}
	if ( config.style === 'currency' ) {
		const match = NUMBER_FORMATS.find(
			( f ) => f.style === 'currency' && f.currency === config.currency
		);
		return match ?? NUMBER_FORMATS[ 3 ];
	}
	return (
		NUMBER_FORMATS.find( ( f ) => f.style === config.style ) ??
		NUMBER_FORMATS[ 0 ]
	);
}

// Mirrors `formatDateValue`'s defaults so the row label matches what
// the column actually renders: datetime fields show time on by default,
// date fields never do, and 12-hour is the default clock.
function findTimeOption( config, type ) {
	const time = config?.time ?? type === 'datetime';
	if ( ! time ) {
		return TIME_OPTIONS[ 0 ];
	}
	const hour12 = config?.hour12 ?? true;
	return hour12 === false ? TIME_OPTIONS[ 2 ] : TIME_OPTIONS[ 1 ];
}

// One submenu row. The label sits left, the current value in the middle
// (muted), and a chevron on the right hints at the third-level flyout.
// `isOpen` toggles the focus ring so users can tell which row spawned
// the visible flyout.
const SubmenuRow = forwardRef( function SubmenuRowComponent(
	{ label, value, onClick, onOpen, isOpen },
	ref
) {
	const onKeyDown = ( event ) => {
		if ( event.key !== 'ArrowRight' ) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		onOpen();
	};

	return (
		<button
			ref={ ref }
			type="button"
			className={
				'cortext-format-submenu__row' + ( isOpen ? ' is-open' : '' )
			}
			onClick={ onClick }
			onKeyDown={ onKeyDown }
			aria-haspopup="menu"
			aria-expanded={ isOpen }
		>
			<span className="cortext-format-submenu__row-label">{ label }</span>
			<span className="cortext-format-submenu__row-value">{ value }</span>
			<Icon
				icon={ chevronRight }
				className="cortext-format-submenu__row-chevron"
			/>
		</button>
	);
} );

function ChoiceList( {
	items,
	isSelected,
	onPick,
	onClose,
	returnFocusRef,
	renderBeforeLabel,
} ) {
	const closeAndReturnFocus = () => {
		onClose();
		focusRefOnNextFrame( returnFocusRef );
	};
	const onKeyDown = ( event ) => {
		if ( event.key === 'Escape' || event.key === 'ArrowLeft' ) {
			event.preventDefault();
			event.stopPropagation();
			closeAndReturnFocus();
			return;
		}
		if ( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) {
			event.preventDefault();
			event.stopPropagation();
			focusRelativeControl(
				event.currentTarget,
				event.currentTarget.ownerDocument.activeElement,
				event.key === 'ArrowDown' ? 1 : -1
			);
			return;
		}
		if ( event.key === 'Home' || event.key === 'End' ) {
			event.preventDefault();
			event.stopPropagation();
			focusEdgeControl(
				event.currentTarget,
				event.key === 'End' ? 'last' : 'first'
			);
		}
	};

	return (
		<ul
			className="cortext-format-submenu__list"
			role="menu"
			onKeyDown={ onKeyDown }
		>
			{ items.map( ( item ) => {
				const selected = isSelected( item );
				return (
					<li key={ item.id ?? item.value } role="none">
						<button
							type="button"
							role="menuitemradio"
							aria-checked={ selected }
							className={
								'cortext-format-submenu__list-item' +
								( selected ? ' is-selected' : '' )
							}
							onClick={ () => onPick( item ) }
						>
							{ renderBeforeLabel ? (
								renderBeforeLabel( item, selected )
							) : (
								<span className="cortext-format-submenu__list-check">
									{ selected ? (
										<Icon icon={ check } />
									) : null }
								</span>
							) }
							<span>{ item.label }</span>
						</button>
					</li>
				);
			} ) }
		</ul>
	);
}

// Tile previews for display choices: a stylized number,
// a horizontal progress bar, and a ring. Plain SVG so they don't depend
// on icon glyphs that don't quite match.
const NumberTilePreview = (
	<span className="cortext-format-submenu__tile-preview-number">42</span>
);

const BarTilePreview = (
	<svg
		className="cortext-format-submenu__tile-preview-bar"
		viewBox="0 0 40 6"
		aria-hidden="true"
	>
		<rect x="0" y="2" width="40" height="2" rx="1" opacity="0.2" />
		<rect x="0" y="2" width="24" height="2" rx="1" />
	</svg>
);

const RingTilePreview = (
	<svg
		className="cortext-format-submenu__tile-preview-ring"
		viewBox="0 0 20 20"
		aria-hidden="true"
	>
		<circle
			cx="10"
			cy="10"
			r="7"
			fill="none"
			strokeWidth="2.5"
			opacity="0.2"
		/>
		<circle
			cx="10"
			cy="10"
			r="7"
			fill="none"
			strokeWidth="2.5"
			strokeDasharray={ 2 * Math.PI * 7 }
			strokeDashoffset={ 2 * Math.PI * 7 * 0.4 }
			transform="rotate(-90 10 10)"
		/>
	</svg>
);

const DISPLAY_OPTIONS = [
	{
		id: 'number',
		label: __( 'Number', 'cortext' ),
		preview: NumberTilePreview,
	},
	{ id: 'bar', label: __( 'Bar', 'cortext' ), preview: BarTilePreview },
	{ id: 'ring', label: __( 'Ring', 'cortext' ), preview: RingTilePreview },
];

function ShowAsTiles( { value, onChange } ) {
	const current = value ?? 'number';
	return (
		<div className="cortext-format-submenu__section">
			<span className="cortext-format-submenu__section-title">
				{ __( 'Show as', 'cortext' ) }
			</span>
			<div className="cortext-format-submenu__tiles">
				{ DISPLAY_OPTIONS.map( ( option ) => {
					const selected = option.id === current;
					return (
						<button
							key={ option.id }
							type="button"
							role="radio"
							aria-checked={ selected }
							className={
								'cortext-format-submenu__tile' +
								( selected ? ' is-selected' : '' )
							}
							onClick={ () => onChange( option.id ) }
						>
							<span className="cortext-format-submenu__tile-preview">
								{ option.preview }
							</span>
							<span className="cortext-format-submenu__tile-label">
								{ option.label }
							</span>
						</button>
					);
				} ) }
			</div>
		</div>
	);
}

function ColorSwatch( { id } ) {
	const color = findFormatColor( id );
	const style = color.hex
		? { background: color.hex }
		: { background: 'var(--wp-admin-theme-color, #007cba)' };
	return (
		<span
			className="cortext-format-submenu__swatch"
			style={ style }
			aria-hidden="true"
		/>
	);
}

function ColorList( { value, onPick, onClose, returnFocusRef } ) {
	const current = value ?? 'default';
	return (
		<ChoiceList
			items={ FORMAT_COLORS }
			isSelected={ ( color ) => color.id === current }
			onPick={ ( color ) => onPick( color.id ) }
			onClose={ onClose }
			returnFocusRef={ returnFocusRef }
			renderBeforeLabel={ ( color, selected ) => (
				<>
					<span className="cortext-format-submenu__list-check">
						{ selected ? <Icon icon={ check } /> : null }
					</span>
					<ColorSwatch id={ color.id } />
				</>
			) }
		/>
	);
}

// Inline-input row for "Divide by" — same row geometry as SubmenuRow but
// with a NumberControl on the right instead of a chevron flyout.
function SubmenuInputRow( { label, value, onChange, min = 1 } ) {
	return (
		<div className="cortext-format-submenu__inline-row">
			<span className="cortext-format-submenu__row-label">{ label }</span>
			<NumberControl
				className="cortext-format-submenu__input"
				value={ value }
				onChange={ ( next ) => {
					const num = Number( next );
					onChange( Number.isFinite( num ) ? num : value );
				} }
				min={ min }
				spinControls="none"
				hideLabelFromVision
				label={ label }
				__next40pxDefaultSize
			/>
		</div>
	);
}

function SubmenuToggleRow( { label, checked, onChange } ) {
	return (
		<div className="cortext-format-submenu__inline-row">
			<span className="cortext-format-submenu__row-label">{ label }</span>
			<ToggleControl
				className="cortext-format-submenu__toggle"
				checked={ checked }
				onChange={ onChange }
				label={ label }
				hideLabelFromVision
				__nextHasNoMarginBottom
			/>
		</div>
	);
}

function NumberFormBody( {
	config,
	onChange,
	anchor,
	panelRef,
	onMouseEnter,
	onMouseLeave,
} ) {
	const {
		submenuRef,
		placement: submenuPlacement,
		openKey: openRow,
		open: setOpenRow,
	} = useSubmenuPlacement( anchor, panelRef );
	const formatRowRef = useRef( null );
	const decimalsRowRef = useRef( null );
	const colorRowRef = useRef( null );
	const current = findNumberFormat( config );
	const decimals = config?.decimals ?? null;
	const hasDecimals = decimals !== null;
	const display = config?.display ?? 'number';
	const isVisual = display === 'bar' || display === 'ring';
	const colorId = config?.color ?? 'default';
	const currentColor = findFormatColor( colorId );
	const divideBy = config?.divideBy ?? 100;
	const showNumber = config?.showNumber !== false;
	// Divide-by has no meaning for percent — values are already 0..1, the
	// visual fills directly. Hide the row to keep the panel tidy.
	const showDivideBy = isVisual && current.style !== 'percent';

	const pickFormat = ( item ) => {
		const next = { ...( config ?? {} ), style: item.style };
		if ( ! hasDecimals ) {
			delete next.decimals;
		}
		if ( item.style === 'currency' ) {
			next.currency = item.currency;
		} else {
			delete next.currency;
		}
		onChange( next );
		setOpenRow( null );
	};

	const pickDecimals = ( value ) => {
		const next = { ...( config ?? { style: 'plain' } ) };
		if ( value === null ) {
			delete next.decimals;
		} else {
			next.decimals = value;
		}
		onChange( next );
		setOpenRow( null );
	};

	const pickDisplay = ( id ) => {
		onChange( {
			...( config ?? { style: 'plain' } ),
			display: id,
		} );
	};

	const pickColor = ( id ) => {
		onChange( { ...( config ?? { style: 'plain' } ), color: id } );
		setOpenRow( null );
	};

	const pickDivideBy = ( n ) => {
		onChange( { ...( config ?? { style: 'plain' } ), divideBy: n } );
	};

	const pickShowNumber = ( checked ) => {
		onChange( {
			...( config ?? { style: 'plain' } ),
			showNumber: checked,
		} );
	};

	return (
		<>
			<SubmenuRow
				ref={ formatRowRef }
				label={ __( 'Number format', 'cortext' ) }
				value={ current.label }
				isOpen={ openRow === 'format' }
				onClick={ () =>
					setOpenRow( openRow === 'format' ? null : 'format' )
				}
				onOpen={ () => setOpenRow( 'format' ) }
			/>
			<SubmenuRow
				ref={ decimalsRowRef }
				label={ __( 'Decimal places', 'cortext' ) }
				value={
					hasDecimals
						? String( decimals )
						: __( 'Default', 'cortext' )
				}
				isOpen={ openRow === 'decimals' }
				onClick={ () =>
					setOpenRow( openRow === 'decimals' ? null : 'decimals' )
				}
				onOpen={ () => setOpenRow( 'decimals' ) }
			/>
			<ShowAsTiles value={ display } onChange={ pickDisplay } />
			{ isVisual ? (
				<div className="cortext-format-submenu__visual-config">
					<SubmenuRow
						ref={ colorRowRef }
						label={ __( 'Color', 'cortext' ) }
						value={
							<span className="cortext-format-submenu__color-value">
								<ColorSwatch id={ colorId } />
								<span>{ currentColor.label }</span>
							</span>
						}
						isOpen={ openRow === 'color' }
						onClick={ () =>
							setOpenRow( openRow === 'color' ? null : 'color' )
						}
						onOpen={ () => setOpenRow( 'color' ) }
					/>
					{ showDivideBy ? (
						<SubmenuInputRow
							label={ __( 'Divide by', 'cortext' ) }
							value={ divideBy }
							onChange={ pickDivideBy }
						/>
					) : null }
					<SubmenuToggleRow
						label={ __( 'Show number', 'cortext' ) }
						checked={ showNumber }
						onChange={ pickShowNumber }
					/>
				</div>
			) : null }
			{ openRow === 'format' ? (
				<Popover
					anchor={ formatRowRef.current }
					placement={ submenuPlacement }
					offset={ 8 }
					shift
					resize={ false }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<div
						ref={ submenuRef }
						onMouseEnter={ onMouseEnter }
						onMouseLeave={ onMouseLeave }
					>
						<ChoiceList
							items={ NUMBER_FORMATS }
							isSelected={ ( item ) => item.id === current.id }
							onPick={ pickFormat }
							onClose={ () => setOpenRow( null ) }
							returnFocusRef={ formatRowRef }
						/>
					</div>
				</Popover>
			) : null }
			{ openRow === 'decimals' ? (
				<Popover
					anchor={ decimalsRowRef.current }
					placement={ submenuPlacement }
					offset={ 8 }
					shift
					resize={ false }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<div
						ref={ submenuRef }
						onMouseEnter={ onMouseEnter }
						onMouseLeave={ onMouseLeave }
					>
						<ChoiceList
							items={ DECIMAL_OPTIONS }
							isSelected={ ( item ) => item.value === decimals }
							onPick={ ( item ) => pickDecimals( item.value ) }
							onClose={ () => setOpenRow( null ) }
							returnFocusRef={ decimalsRowRef }
						/>
					</div>
				</Popover>
			) : null }
			{ openRow === 'color' ? (
				<Popover
					anchor={ colorRowRef.current }
					placement={ submenuPlacement }
					offset={ 8 }
					shift
					resize={ false }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<div
						ref={ submenuRef }
						onMouseEnter={ onMouseEnter }
						onMouseLeave={ onMouseLeave }
					>
						<ColorList
							value={ colorId }
							onPick={ pickColor }
							onClose={ () => setOpenRow( null ) }
							returnFocusRef={ colorRowRef }
						/>
					</div>
				</Popover>
			) : null }
		</>
	);
}

function DateFormBody( {
	type,
	config,
	onChange,
	anchor,
	panelRef,
	onMouseEnter,
	onMouseLeave,
} ) {
	const {
		submenuRef,
		placement: submenuPlacement,
		openKey: openRow,
		open: setOpenRow,
	} = useSubmenuPlacement( anchor, panelRef );
	const formatRowRef = useRef( null );
	const timeRowRef = useRef( null );
	// `date` fields store dates without a time component, the inline
	// editor strips time on commit, and the renderer ignores time
	// options for date-only values. Hide the Time row entirely so we
	// don't expose a control that has nothing to act on.
	const supportsTime = type === 'datetime';

	const styleId = config?.style ?? 'locale';
	const currentDateFormat =
		DATE_FORMATS.find( ( f ) => f.id === styleId ) ?? DATE_FORMATS[ 0 ];
	const currentTime = findTimeOption( config, type );

	const pickFormat = ( item ) => {
		onChange( {
			style: item.id,
			time: supportsTime ? config?.time ?? true : false,
			hour12: config?.hour12 ?? true,
		} );
		setOpenRow( null );
	};

	const pickTime = ( item ) => {
		onChange( {
			style: config?.style ?? 'locale',
			time: item.time,
			hour12: item.time ? item.hour12 : config?.hour12 ?? true,
		} );
		setOpenRow( null );
	};

	return (
		<>
			<SubmenuRow
				ref={ formatRowRef }
				label={ __( 'Date format', 'cortext' ) }
				value={ currentDateFormat.label }
				isOpen={ openRow === 'format' }
				onClick={ () =>
					setOpenRow( openRow === 'format' ? null : 'format' )
				}
				onOpen={ () => setOpenRow( 'format' ) }
			/>
			{ supportsTime ? (
				<SubmenuRow
					ref={ timeRowRef }
					label={ __( 'Time', 'cortext' ) }
					value={ currentTime.label }
					isOpen={ openRow === 'time' }
					onClick={ () =>
						setOpenRow( openRow === 'time' ? null : 'time' )
					}
					onOpen={ () => setOpenRow( 'time' ) }
				/>
			) : null }
			{ openRow === 'format' ? (
				<Popover
					anchor={ formatRowRef.current }
					placement={ submenuPlacement }
					offset={ 8 }
					shift
					resize={ false }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<div
						ref={ submenuRef }
						onMouseEnter={ onMouseEnter }
						onMouseLeave={ onMouseLeave }
					>
						<ChoiceList
							items={ DATE_FORMATS }
							isSelected={ ( item ) =>
								item.id === currentDateFormat.id
							}
							onPick={ pickFormat }
							onClose={ () => setOpenRow( null ) }
							returnFocusRef={ formatRowRef }
						/>
					</div>
				</Popover>
			) : null }
			{ supportsTime && openRow === 'time' ? (
				<Popover
					anchor={ timeRowRef.current }
					placement={ submenuPlacement }
					offset={ 8 }
					shift
					resize={ false }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<div
						ref={ submenuRef }
						onMouseEnter={ onMouseEnter }
						onMouseLeave={ onMouseLeave }
					>
						<ChoiceList
							items={ TIME_OPTIONS }
							isSelected={ ( item ) =>
								item.id === currentTime.id
							}
							onPick={ pickTime }
							onClose={ () => setOpenRow( null ) }
							returnFocusRef={ timeRowRef }
						/>
					</div>
				</Popover>
			) : null }
		</>
	);
}

// Renders a cascading format menu. Anchored to the Format
// menu item so it sits beside the column dropdown. Auto-saves on every
// selection. Hover handlers keep the panel open while the cursor is
// somewhere over the column dropdown's Format row or this panel; the
// parent owns the grace timer (`scheduleClose`) that absorbs the dead
// pixels between them. Keyboard-opened panels can opt into focusOnMount so
// tabbing enters the panel instead of moving to the next table column.
export default function FieldFormatPopover( {
	recordId,
	anchor,
	focusOnMount = false,
	onClose,
	onCloseWithFocus,
	onMouseEnter,
	onMouseLeave,
} ) {
	const panelRef = useRef( null );
	const { record } = useEntityRecord( 'postType', 'crtxt_field', recordId );
	const { editEntityRecord, saveEditedEntityRecord } = useDispatch( 'core' );

	const type = record?.meta?.type ?? 'text';
	const isNumber = type === 'number';
	const isDate = type === 'date' || type === 'datetime';

	const initial = useMemo(
		() =>
			parseFormat(
				isNumber
					? record?.meta?.number_format
					: record?.meta?.date_format
			),
		[ isNumber, record ]
	);

	const persist = async ( next ) => {
		if ( ! record ) {
			return;
		}
		const key = isNumber ? 'number_format' : 'date_format';
		editEntityRecord( 'postType', 'crtxt_field', recordId, {
			meta: { [ key ]: next ? JSON.stringify( next ) : '' },
		} );
		await saveEditedEntityRecord( 'postType', 'crtxt_field', recordId );
	};

	if ( ! record || ( ! isNumber && ! isDate ) ) {
		return null;
	}

	const onPopoverKeyDown = ( event ) => {
		const activeElement = event.currentTarget.ownerDocument.activeElement;
		if (
			( event.key === 'ArrowDown' || event.key === 'ArrowUp' ) &&
			! shouldLetElementHandleArrowKeys( activeElement )
		) {
			const panel = event.currentTarget.querySelector(
				'.cortext-format-submenu__panel'
			);
			if (
				focusRelativeControl(
					panel,
					activeElement,
					event.key === 'ArrowDown' ? 1 : -1
				)
			) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		if (
			( event.key === 'Home' || event.key === 'End' ) &&
			! shouldLetElementHandleArrowKeys( activeElement )
		) {
			const panel = event.currentTarget.querySelector(
				'.cortext-format-submenu__panel'
			);
			if (
				focusEdgeControl(
					panel,
					event.key === 'End' ? 'last' : 'first'
				)
			) {
				event.preventDefault();
				event.stopPropagation();
			}
			return;
		}
		if (
			event.key !== 'Escape' &&
			( event.key !== 'ArrowLeft' ||
				shouldLetElementHandleArrowKeys( activeElement ) )
		) {
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		onCloseWithFocus();
	};

	return (
		<Popover
			anchor={ anchor }
			placement="right-start"
			offset={ 8 }
			onClose={ onClose }
			focusOnMount={ focusOnMount }
			className="cortext-format-submenu"
			onKeyDown={ onPopoverKeyDown }
		>
			<div
				ref={ panelRef }
				className="cortext-format-submenu__panel"
				onMouseEnter={ onMouseEnter }
				onMouseLeave={ onMouseLeave }
			>
				{ isNumber ? (
					<NumberFormBody
						config={ initial }
						onChange={ persist }
						anchor={ anchor }
						panelRef={ panelRef }
						onMouseEnter={ onMouseEnter }
						onMouseLeave={ onMouseLeave }
					/>
				) : (
					<DateFormBody
						type={ type }
						config={ initial }
						onChange={ persist }
						anchor={ anchor }
						panelRef={ panelRef }
						onMouseEnter={ onMouseEnter }
						onMouseLeave={ onMouseLeave }
					/>
				) }
				<p className="cortext-format-submenu__note">
					{ __(
						'Changes apply to all views showing this field.',
						'cortext'
					) }
				</p>
			</div>
		</Popover>
	);
}
