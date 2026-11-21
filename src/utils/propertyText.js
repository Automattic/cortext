// Turns a row's property values into display text for property bindings
// and inline property references.
//
// The public page formats the same values in `includes/Fields/PropertyText.php`.
// Both sides run `tests/fixtures/property-text.json`, so a change to one
// side needs the same change on the other.
import { __ } from '@wordpress/i18n';
import { dateI18n } from '@wordpress/date';

import { formatDateValue, formatNumberValue } from '../components/EditableCell';
import { rollupDisplayType } from '../hooks/fieldMapping';
import { valueForField } from '../components/rowDetailUtils';

export const SYSTEM_PROPERTY_KEYS = [
	'created_at',
	'created_by',
	'modified_at',
	'modified_by',
];

const SYSTEM_DATE_KEYS = new Set( [ 'created_at', 'modified_at' ] );
const SYSTEM_DATE_DISPLAY_FORMAT = 'M j, Y g:i a';

function isChecked( value ) {
	if ( typeof value === 'boolean' ) {
		return value;
	}
	return [ '1', 'true', 'yes', 'on' ].includes(
		String( value ).trim().toLowerCase()
	);
}

function optionLabel( value, elements = [] ) {
	const element = elements.find( ( entry ) =>
		typeof entry === 'string'
			? entry === value
			: String( entry?.value ?? '' ) === value
	);
	if ( element === undefined ) {
		return value;
	}
	return typeof element === 'string'
		? element
		: String( element.label ?? element.value );
}

function formatDateRange( value, format = {} ) {
	if ( ! value || typeof value !== 'object' ) {
		return '';
	}
	const type = format.rollup_target_type === 'datetime' ? 'datetime' : 'date';
	const start = value.start
		? formatDateValue( value.start, type, format )
		: '';
	const end = value.end ? formatDateValue( value.end, type, format ) : '';
	if ( start && end && start !== end ) {
		return `${ start } - ${ end }`;
	}
	return start || end;
}

/**
 * Formats a typed value for display.
 *
 * @param {*}      value  Typed value, as found in `cortext_hydrated_meta`.
 * @param {Object} config `type` (display type), optional `format` and `elements`.
 * @return {string} Display text, or '' for an empty value.
 */
export function formatPropertyText( value, config ) {
	const type = config?.type ?? 'text';

	// An unset checkbox is unchecked, not empty.
	if ( type === 'checkbox' && ! Array.isArray( value ) ) {
		return isChecked( value ?? '' )
			? __( 'Yes', 'cortext' )
			: __( 'No', 'cortext' );
	}

	if ( value === null || value === undefined || value === '' ) {
		return '';
	}

	if ( type === 'rollup-date-range' ) {
		return formatDateRange( value, config.format );
	}

	if ( type === 'relation' ) {
		return ( Array.isArray( value ) ? value : [] )
			.map( ( ref ) => ref?.title?.raw || __( '(untitled)', 'cortext' ) )
			.join( ', ' );
	}

	if ( Array.isArray( value ) ) {
		const scalarConfig =
			type === 'multiselect' ? { ...config, type: 'select' } : config;
		return value
			.map( ( item ) => formatPropertyText( item, scalarConfig ) )
			.filter( Boolean )
			.join( ', ' );
	}

	switch ( type ) {
		case 'number':
			return formatNumberValue( value, config.format ?? {} );
		case 'date':
		case 'datetime':
			return formatDateValue(
				String( value ),
				type,
				config.format ?? {}
			);
		case 'select':
		case 'multiselect':
			return optionLabel( String( value ), config.elements );
		default:
			return typeof value === 'object' ? '' : String( value ).trim();
	}
}

/**
 * Builds the `formatPropertyText` config for a mapped DataViews field, the
 * same display type `fieldMapping`'s cell renderer uses.
 *
 * @param {Object} field Field from `mapField`.
 * @return {Object} Format config.
 */
export function propertyTextConfig( field ) {
	const type = field.cortextFieldType ?? field.cortextType ?? 'text';
	let displayType = type;
	if ( type === 'formula' ) {
		displayType = field.formulaResultType ?? 'text';
	} else if ( type === 'rollup' ) {
		displayType = rollupDisplayType( field.cortextFormat );
	}
	return {
		type: displayType,
		format: field.cortextFormat,
		elements: field.cortextElements,
	};
}

/**
 * Display text for one of a row's properties.
 *
 * @param {Object}  field         Field from `mapField` or `systemFields`.
 * @param {Object}  record        Edited row record.
 * @param {Object}  [options]
 * @param {boolean} [options.raw] Skip locale formatting, for attributes
 *                                such as an image URL or ID.
 * @return {string} Display text, or '' for an empty value.
 */
export function propertyText( field, record, { raw = false } = {} ) {
	const value = valueForField( field, {
		meta: record?.meta,
		hydratedMeta: record?.cortext_hydrated_meta,
		row: record,
	} );

	if ( SYSTEM_PROPERTY_KEYS.includes( field.id ) ) {
		if ( ! value ) {
			return '';
		}
		return SYSTEM_DATE_KEYS.has( field.id ) && ! raw
			? dateI18n( SYSTEM_DATE_DISPLAY_FORMAT, value )
			: String( value );
	}

	const config = propertyTextConfig( field );
	if ( ! raw ) {
		return formatPropertyText( value, config );
	}
	if ( Array.isArray( value ) ) {
		return config.type === 'relation'
			? ''
			: value.filter( ( item ) => typeof item !== 'object' ).join( ', ' );
	}
	if ( typeof value === 'boolean' ) {
		return value ? '1' : '';
	}
	return value === null || value === undefined || typeof value === 'object'
		? ''
		: String( value ).trim();
}

/**
 * The key a property reference stores: the field's post ID, or the system
 * field key.
 *
 * @param {Object} field Field from `mapField` or `systemFields`.
 * @return {string} Property key.
 */
export function propertyKey( field ) {
	return field.recordId ? String( field.recordId ) : field.id;
}
