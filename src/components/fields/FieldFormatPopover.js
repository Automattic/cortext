import { __ } from '@wordpress/i18n';
import { Icon, Popover } from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { forwardRef, useMemo, useRef, useState } from '@wordpress/element';
import { check, chevronRight } from '@wordpress/icons';

import { parseFormat } from '../../hooks/fieldMapping';

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

const DECIMAL_OPTIONS = [ 0, 1, 2, 3, 4, 5, 6 ];

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

function findTimeOption( config ) {
	if ( ! config?.time ) {
		return TIME_OPTIONS[ 0 ];
	}
	return config.hour12 === false ? TIME_OPTIONS[ 2 ] : TIME_OPTIONS[ 1 ];
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

function NumberFormBody( { config, onChange } ) {
	const [ openRow, setOpenRow ] = useState( null );
	const formatRowRef = useRef( null );
	const decimalsRowRef = useRef( null );
	const current = findNumberFormat( config );
	const decimals = config?.decimals ?? 0;

	const pickFormat = ( item ) => {
		const next = { style: item.style, decimals };
		if ( item.style === 'currency' ) {
			next.currency = item.currency;
		}
		onChange( next );
		setOpenRow( null );
	};

	const pickDecimals = ( n ) => {
		onChange( { ...( config ?? { style: 'plain' } ), decimals: n } );
		setOpenRow( null );
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
				value={ String( decimals ) }
				isOpen={ openRow === 'decimals' }
				onClick={ () =>
					setOpenRow( openRow === 'decimals' ? null : 'decimals' )
				}
			/>
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
						items={ DECIMAL_OPTIONS.map( ( n ) => ( {
							id: `d${ n }`,
							label: String( n ),
							value: n,
						} ) ) }
						isSelected={ ( item ) => item.value === decimals }
						onPick={ ( item ) => pickDecimals( item.value ) }
					/>
				</Popover>
			) : null }
		</>
	);
}

function DateFormBody( { type, config, onChange } ) {
	const [ openRow, setOpenRow ] = useState( null );
	const formatRowRef = useRef( null );
	const timeRowRef = useRef( null );

	const styleId = config?.style ?? 'locale';
	const currentDateFormat =
		DATE_FORMATS.find( ( f ) => f.id === styleId ) ?? DATE_FORMATS[ 0 ];
	const currentTime = findTimeOption( config );

	const pickFormat = ( item ) => {
		onChange( {
			style: item.id,
			time: config?.time ?? type === 'datetime',
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
			<SubmenuRow
				ref={ timeRowRef }
				label={ __( 'Time', 'cortext' ) }
				value={ currentTime.label }
				isOpen={ openRow === 'time' }
				onClick={ () =>
					setOpenRow( openRow === 'time' ? null : 'time' )
				}
			/>
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
			{ openRow === 'time' ? (
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
