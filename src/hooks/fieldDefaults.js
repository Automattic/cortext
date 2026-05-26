export const DEFAULT_SUPPORTED_TYPES = new Set( [
	'text',
	'url',
	'email',
	'number',
	'date',
	'datetime',
	'checkbox',
	'select',
	'multiselect',
] );

function parseRawDefaultConfig( raw ) {
	if ( ! raw ) {
		return null;
	}
	let parsed = raw;
	if ( typeof raw === 'string' ) {
		try {
			parsed = JSON.parse( raw );
		} catch {
			return null;
		}
	}
	if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
		return null;
	}
	if ( parsed.mode === 'today' ) {
		return { mode: 'today' };
	}
	if ( parsed.mode !== 'value' || ! ( 'value' in parsed ) ) {
		return null;
	}
	return { mode: 'value', value: parsed.value };
}

function optionValues( elements ) {
	return Array.isArray( elements )
		? elements.map( ( option ) => option.value ).filter( Boolean )
		: [];
}

function normalizeBoolean( value ) {
	if ( typeof value === 'boolean' ) {
		return value;
	}
	if ( typeof value === 'number' ) {
		return value !== 0;
	}
	return [ '1', 'true', 'yes', 'on' ].includes(
		String( value ?? '' )
			.trim()
			.toLowerCase()
	);
}

function normalizeString( value ) {
	const text = String( value ?? '' ).trim();
	return text || null;
}

function normalizeDate( value ) {
	const text = normalizeString( value );
	if ( ! text || ! /^\d{4}-\d{2}-\d{2}$/.test( text ) ) {
		return null;
	}
	const date = new Date( `${ text }T00:00:00Z` );
	return Number.isNaN( date.getTime() ) ? null : text;
}

function normalizeDatetime( value ) {
	const text = normalizeString( value );
	if ( ! text ) {
		return null;
	}
	const timestamp = Date.parse( text );
	return Number.isNaN( timestamp )
		? null
		: new Date( timestamp ).toISOString();
}

export function parseDefaultConfig( raw, type, elements ) {
	if ( ! DEFAULT_SUPPORTED_TYPES.has( type ) ) {
		return null;
	}

	const config = parseRawDefaultConfig( raw );
	if ( ! config ) {
		return null;
	}

	if ( config.mode === 'today' ) {
		return type === 'date' || type === 'datetime'
			? { mode: 'today' }
			: null;
	}

	switch ( type ) {
		case 'text':
		case 'url':
		case 'email': {
			const value = normalizeString( config.value );
			return value ? { mode: 'value', value } : null;
		}
		case 'number': {
			const value = Number( config.value );
			return Number.isFinite( value ) ? { mode: 'value', value } : null;
		}
		case 'date': {
			const value = normalizeDate( config.value );
			return value ? { mode: 'value', value } : null;
		}
		case 'datetime': {
			const value = normalizeDatetime( config.value );
			return value ? { mode: 'value', value } : null;
		}
		case 'checkbox':
			return { mode: 'value', value: normalizeBoolean( config.value ) };
		case 'select': {
			const value = normalizeString( config.value );
			const values = optionValues( elements );
			return value && values.includes( value )
				? { mode: 'value', value }
				: null;
		}
		case 'multiselect': {
			const values = optionValues( elements );
			const selected = (
				Array.isArray( config.value ) ? config.value : [ config.value ]
			)
				.map( normalizeString )
				.filter(
					( value, index, list ) =>
						value &&
						values.includes( value ) &&
						list.indexOf( value ) === index
				);
			return selected.length ? { mode: 'value', value: selected } : null;
		}
		default:
			return null;
	}
}

export function encodeDefaultConfig( config ) {
	return config ? JSON.stringify( config ) : '';
}
