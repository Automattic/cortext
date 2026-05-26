export const DISPLAY_FIELD_KEYS = [
	'titleField',
	'mediaField',
	'descriptionField',
];

const LAYOUT_TYPES = [ 'table', 'grid', 'list' ];
const DISPLAY_FIELD_LAYOUT_TYPES = [ 'grid', 'list' ];

// normalizeView uses this only when reading saved widths. It rejects negative
// or extreme numbers from hand-edited block attributes, while preserving CSS
// string widths that DataViews supports (`240px`, `20ch`). It does not enforce
// per-type minimums because those change over time and should not rewrite saves
// during render.
function sanitizeWidth( width, maxColumnWidth ) {
	if ( typeof width === 'string' ) {
		return width;
	}

	const value = Number( width );
	if ( ! Number.isFinite( value ) ) {
		return 0;
	}
	return Math.max( 0, Math.min( maxColumnWidth, Math.round( value ) ) );
}

export function sanitizeLayoutForFields(
	layout = {},
	validSet,
	{ maxColumnWidth = 640 } = {}
) {
	if ( ! layout || typeof layout !== 'object' || Array.isArray( layout ) ) {
		return { layout: {}, changed: Boolean( layout ) };
	}

	const hasStylesObject =
		layout.styles &&
		typeof layout.styles === 'object' &&
		! Array.isArray( layout.styles );
	const styles = hasStylesObject ? layout.styles : {};
	const nextStyles = {};
	let stylesChanged =
		layout.styles !== undefined &&
		layout.styles !== null &&
		! hasStylesObject;
	for ( const id of Object.keys( styles ) ) {
		if ( ! validSet.has( id ) ) {
			stylesChanged = true;
			continue;
		}
		const entry = styles[ id ];
		if ( ! entry || typeof entry !== 'object' ) {
			stylesChanged = true;
			continue;
		}
		const next = { ...entry };
		if ( entry.width !== undefined ) {
			const clamped = sanitizeWidth( entry.width, maxColumnWidth );
			if ( clamped !== entry.width ) {
				stylesChanged = true;
			}
			next.width = clamped;
		}
		nextStyles[ id ] = next;
	}

	const nextLayout = { ...layout };
	if ( Object.keys( nextStyles ).length > 0 ) {
		nextLayout.styles = nextStyles;
	} else {
		delete nextLayout.styles;
	}

	const hasBadgeFields = Object.prototype.hasOwnProperty.call(
		layout,
		'badgeFields'
	);
	const currentBadgeFields = Array.isArray( layout.badgeFields )
		? layout.badgeFields
		: null;
	let badgeFieldsChanged = hasBadgeFields && ! currentBadgeFields;
	if ( currentBadgeFields ) {
		const nextBadgeFields = currentBadgeFields.filter( ( id ) =>
			validSet.has( id )
		);
		badgeFieldsChanged =
			nextBadgeFields.length !== currentBadgeFields.length;
		if ( nextBadgeFields.length > 0 ) {
			nextLayout.badgeFields = nextBadgeFields;
		} else {
			delete nextLayout.badgeFields;
		}
	} else if ( hasBadgeFields ) {
		delete nextLayout.badgeFields;
	}

	return {
		layout: nextLayout,
		changed: stylesChanged || badgeFieldsChanged,
	};
}

export function sanitizeLayoutByType( layoutByType, validSet, options = {} ) {
	if ( layoutByType === undefined ) {
		return { layoutByType: undefined, changed: false };
	}
	if (
		! layoutByType ||
		typeof layoutByType !== 'object' ||
		Array.isArray( layoutByType )
	) {
		return { layoutByType: undefined, changed: true };
	}

	const next = {};
	let changed = false;
	for ( const type of LAYOUT_TYPES ) {
		if ( ! Object.prototype.hasOwnProperty.call( layoutByType, type ) ) {
			continue;
		}
		const result = sanitizeLayoutForFields(
			layoutByType[ type ],
			validSet,
			options
		);
		next[ type ] = result.layout;
		if ( result.changed ) {
			changed = true;
		}
	}
	if (
		Object.keys( layoutByType ).some(
			( type ) => ! LAYOUT_TYPES.includes( type )
		)
	) {
		changed = true;
	}
	return { layoutByType: next, changed };
}

function sanitizeDisplayFields( fields, validSet, titleId ) {
	if ( ! Array.isArray( fields ) ) {
		return { fields: [], changed: fields !== undefined };
	}

	const seen = new Set();
	const next = [];
	let changed = false;
	for ( const id of fields ) {
		if ( id === titleId || ! validSet.has( id ) || seen.has( id ) ) {
			changed = true;
			continue;
		}
		seen.add( id );
		next.push( id );
	}
	return { fields: next, changed };
}

export function sanitizeFieldsByType(
	fieldsByType,
	validSet,
	{ titleId = 'title' } = {}
) {
	if ( fieldsByType === undefined ) {
		return { fieldsByType: undefined, changed: false };
	}
	if (
		! fieldsByType ||
		typeof fieldsByType !== 'object' ||
		Array.isArray( fieldsByType )
	) {
		return { fieldsByType: undefined, changed: true };
	}

	const next = {};
	let changed = false;
	for ( const type of DISPLAY_FIELD_LAYOUT_TYPES ) {
		if ( ! Object.prototype.hasOwnProperty.call( fieldsByType, type ) ) {
			continue;
		}
		const result = sanitizeDisplayFields(
			fieldsByType[ type ],
			validSet,
			titleId
		);
		next[ type ] = result.fields;
		if ( result.changed ) {
			changed = true;
		}
	}
	if (
		Object.keys( fieldsByType ).some(
			( type ) => ! DISPLAY_FIELD_LAYOUT_TYPES.includes( type )
		)
	) {
		changed = true;
	}
	return { fieldsByType: next, changed };
}

export function sanitizeDisplayFieldKeys(
	view,
	validSet,
	displayFieldKeys = DISPLAY_FIELD_KEYS
) {
	const values = {};
	let changed = false;
	for ( const key of displayFieldKeys ) {
		const value = view?.[ key ];
		if ( value === undefined ) {
			continue;
		}
		if ( validSet.has( value ) ) {
			values[ key ] = value;
			continue;
		}
		changed = true;
	}
	return { values, changed };
}
