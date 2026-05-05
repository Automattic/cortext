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
import { forwardRef, useMemo, useRef, useState } from '@wordpress/element';
import { check, chevronRight } from '@wordpress/icons';

import { parseFormat } from '../../hooks/fieldMapping';
import { FORMAT_COLORS, findFormatColor } from './formatColors';

// Number "format" rows flatten the storage shape (style + currency) into
// a single flat list so the menu mirrors Notion. Each entry carries the
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
const SubmenuRow = forwardRef( function SubmenuRow(
	{ label, value, onClick, isOpen },
	ref
) {
	return (
		<button
			ref={ ref }
			type="button"
			className={
				'cortext-format-submenu__row' + ( isOpen ? ' is-open' : '' )
			}
			onClick={ onClick }
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

function ChoiceList( { items, isSelected, onPick } ) {
	return (
		<ul className="cortext-format-submenu__list" role="menu">
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
							<span className="cortext-format-submenu__list-check">
								{ selected ? <Icon icon={ check } /> : null }
							</span>
							<span>{ item.label }</span>
						</button>
					</li>
				);
			} ) }
		</ul>
	);
}

// Tile previews mimic Notion's "Show as" thumbnails: a stylized number,
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

function ColorList( { value, onPick } ) {
	const current = value ?? 'default';
	return (
		<ul className="cortext-format-submenu__list" role="menu">
			{ FORMAT_COLORS.map( ( color ) => {
				const selected = color.id === current;
				return (
					<li key={ color.id } role="none">
						<button
							type="button"
							role="menuitemradio"
							aria-checked={ selected }
							className={
								'cortext-format-submenu__list-item' +
								( selected ? ' is-selected' : '' )
							}
							onClick={ () => onPick( color.id ) }
						>
							<span className="cortext-format-submenu__list-check">
								{ selected ? <Icon icon={ check } /> : null }
							</span>
							<ColorSwatch id={ color.id } />
							<span>{ color.label }</span>
						</button>
					</li>
				);
			} ) }
		</ul>
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

function NumberFormBody( { config, onChange } ) {
	const [ openRow, setOpenRow ] = useState( null );
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
					placement="right-start"
					offset={ 8 }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<ChoiceList
						items={ NUMBER_FORMATS }
						isSelected={ ( item ) => item.id === current.id }
						onPick={ pickFormat }
					/>
				</Popover>
			) : null }
			{ openRow === 'decimals' ? (
				<Popover
					anchor={ decimalsRowRef.current }
					placement="right-start"
					offset={ 8 }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<ChoiceList
						items={ DECIMAL_OPTIONS }
						isSelected={ ( item ) => item.value === decimals }
						onPick={ ( item ) => pickDecimals( item.value ) }
					/>
				</Popover>
			) : null }
			{ openRow === 'color' ? (
				<Popover
					anchor={ colorRowRef.current }
					placement="right-start"
					offset={ 8 }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<ColorList value={ colorId } onPick={ pickColor } />
				</Popover>
			) : null }
		</>
	);
}

function DateFormBody( { type, config, onChange } ) {
	const [ openRow, setOpenRow ] = useState( null );
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
				/>
			) : null }
			{ openRow === 'format' ? (
				<Popover
					anchor={ formatRowRef.current }
					placement="right-start"
					offset={ 8 }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<ChoiceList
						items={ DATE_FORMATS }
						isSelected={ ( item ) =>
							item.id === currentDateFormat.id
						}
						onPick={ pickFormat }
					/>
				</Popover>
			) : null }
			{ supportsTime && openRow === 'time' ? (
				<Popover
					anchor={ timeRowRef.current }
					placement="right-start"
					offset={ 8 }
					onClose={ () => setOpenRow( null ) }
					className="cortext-format-submenu__flyout"
				>
					<ChoiceList
						items={ TIME_OPTIONS }
						isSelected={ ( item ) => item.id === currentTime.id }
						onPick={ pickTime }
					/>
				</Popover>
			) : null }
		</>
	);
}

// Renders Notion-style cascading format menu. Anchored to the Format
// menu item so it sits beside the column dropdown. Auto-saves on every
// selection. Hover handlers keep the panel open while the cursor is
// somewhere over the column dropdown's Format row or this panel; the
// parent owns the grace timer (`scheduleClose`) that absorbs the dead
// pixels between them. `focusOnMount={ false }` keeps focus inside the
// parent dropdown so it doesn't auto-close when the panel mounts.
export default function FieldFormatPopover( {
	recordId,
	anchor,
	onClose,
	onMouseEnter,
	onMouseLeave,
} ) {
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

	return (
		<Popover
			anchor={ anchor }
			placement="right-start"
			offset={ 8 }
			onClose={ onClose }
			focusOnMount={ false }
			className="cortext-format-submenu"
		>
			<div
				className="cortext-format-submenu__panel"
				onMouseEnter={ onMouseEnter }
				onMouseLeave={ onMouseLeave }
			>
				{ isNumber ? (
					<NumberFormBody config={ initial } onChange={ persist } />
				) : (
					<DateFormBody
						type={ type }
						config={ initial }
						onChange={ persist }
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
