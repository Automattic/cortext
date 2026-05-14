/**
 * Helpers for the DataView block's table column interactions: resize and
 * reorder. The shape used to persist widths is the one `@wordpress/dataviews`
 * already reads at render time — `view.layout.styles[fieldId] = { width,
 * minWidth, maxWidth }` — so the library applies the values without any
 * custom render path. Order persists on `view.fields`, also library-native.
 */

import { sanitizeCalculations } from './tableCalculations';

export const TITLE_FIELD_ID = 'title';
export const GHOST_FIELD_ID = '__add_field';
export const MANUAL_SORT_ID = 'manual';
export const MAX_COLUMN_WIDTH = 640;

// Per-type minimum widths. 32px is wide enough for a checkbox-sized
// affordance and lets autofit shrink short values (single-digit integers,
// short text) down to their rendered width. Title stays wider because it's
// the row identity; dates need room for a typical formatted value.
export const MIN_WIDTHS = {
	title: 80,
	date: 64,
	datetime: 64,
};
export const DEFAULT_MIN_WIDTH = 32;

// Default view seeding should show user-created collection fields even
// when a field is read-only, as with rollups. System fields stay hidden
// because they have no backing `crtxt_field` record.
export function isDefaultVisibleField( field ) {
	return Boolean( field?.editable || field?.recordId );
}

export function getMinWidth( fieldType ) {
	return MIN_WIDTHS[ fieldType ] ?? DEFAULT_MIN_WIDTH;
}

// Clamp a width into the per-type [min, max] range used at write time
// (resize drag). Falls back to the per-type min for non-finite input.
export function clampWidth( width, fieldType ) {
	const min = getMinWidth( fieldType );
	const value = Number( width );
	if ( ! Number.isFinite( value ) ) {
		return min;
	}
	return Math.max( min, Math.min( MAX_COLUMN_WIDTH, Math.round( value ) ) );
}

// Sanitize-only clamp used by normalizeView when reading persisted widths.
// Guards numeric widths against negatives or absurd values from a hand-edited
// block attribute, but preserves CSS string widths supported by DataViews
// (for example `240px` or `20ch`). It also doesn't enforce per-type minimums
// — those evolve over time and shouldn't quietly rewrite saves on render.
function sanitizeWidth( width ) {
	if ( typeof width === 'string' ) {
		return width;
	}

	const value = Number( width );
	if ( ! Number.isFinite( value ) ) {
		return 0;
	}
	return Math.max( 0, Math.min( MAX_COLUMN_WIDTH, Math.round( value ) ) );
}

function sameShallowObject( a, b ) {
	const aKeys = Object.keys( a );
	const bKeys = Object.keys( b );
	return (
		aKeys.length === bKeys.length &&
		aKeys.every( ( key ) => a[ key ] === b[ key ] )
	);
}

function pruneFilterNodeForFields( filter, validSet ) {
	if ( ! filter || typeof filter !== 'object' ) {
		return null;
	}

	const isGroup = Boolean( filter.relation || filter.filters );
	if ( ! isGroup ) {
		return filter.field && validSet.has( filter.field ) ? filter : null;
	}

	const currentChildren = Array.isArray( filter.filters )
		? filter.filters
		: [];
	const nextChildren = pruneFiltersForFields( currentChildren, validSet );
	if ( nextChildren.length === 0 ) {
		return null;
	}
	return nextChildren === currentChildren
		? filter
		: { ...filter, filters: nextChildren };
}

export function pruneFiltersForFields( filters, validIds ) {
	if ( ! Array.isArray( filters ) ) {
		return [];
	}

	const validSet =
		validIds instanceof Set ? validIds : new Set( validIds ?? [] );
	let changed = false;
	const next = [];
	for ( const filter of filters ) {
		const pruned = pruneFilterNodeForFields( filter, validSet );
		if ( ! pruned ) {
			changed = true;
			continue;
		}
		if ( pruned !== filter ) {
			changed = true;
		}
		next.push( pruned );
	}
	return changed ? next : filters;
}

// Reconciles a saved view against the live field set: drops style entries for
// fields that no longer exist, clamps persisted widths into the current
// [min, max] range, and re-prepends the title id when reorder/cleanup left it
// out. Other view settings (sort, filters, density, search, perPage) are left
// to the caller — those have their own reconciliation rules.
export function normalizeView( view, validIds, options = {} ) {
	const titleId = options.titleId ?? TITLE_FIELD_ID;
	const validSet =
		validIds instanceof Set ? validIds : new Set( validIds ?? [] );

	const currentFields = Array.isArray( view?.fields ) ? view.fields : [];
	let nextFields = currentFields.filter( ( id ) => validSet.has( id ) );
	if ( validSet.has( titleId ) && ! nextFields.includes( titleId ) ) {
		nextFields = [ titleId, ...nextFields ];
	}

	const layout = view?.layout ?? {};
	const styles = layout.styles ?? {};
	const nextStyles = {};
	let stylesChanged = false;
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
			const clamped = sanitizeWidth( entry.width );
			if ( clamped !== entry.width ) {
				stylesChanged = true;
			}
			next.width = clamped;
		}
		nextStyles[ id ] = next;
	}

	const fieldsChanged =
		currentFields.length !== nextFields.length ||
		currentFields.some( ( id, i ) => id !== nextFields[ i ] );
	const rawCalculations = view?.calculations;
	const hasCalculationObject =
		rawCalculations &&
		typeof rawCalculations === 'object' &&
		! Array.isArray( rawCalculations );
	const currentCalculations = hasCalculationObject ? rawCalculations : {};
	const nextCalculations = Array.isArray( options.fields )
		? sanitizeCalculations(
				currentCalculations,
				options.fields.filter( ( field ) => validSet.has( field.id ) )
		  )
		: Object.fromEntries(
				Object.entries( currentCalculations ).filter( ( [ id ] ) =>
					validSet.has( id )
				)
		  );
	const calculationsChanged =
		( rawCalculations !== undefined && ! hasCalculationObject ) ||
		! sameShallowObject( currentCalculations, nextCalculations );

	if ( ! fieldsChanged && ! stylesChanged && ! calculationsChanged ) {
		return view;
	}

	const nextLayout = { ...layout };
	if ( Object.keys( nextStyles ).length > 0 ) {
		nextLayout.styles = nextStyles;
	} else {
		delete nextLayout.styles;
	}

	const nextView = {
		...view,
		fields: nextFields,
		layout: nextLayout,
	};
	if ( Object.keys( nextCalculations ).length > 0 ) {
		nextView.calculations = nextCalculations;
	} else {
		delete nextView.calculations;
	}

	return nextView;
}

// Applies a width to a single column. Always returns through the layout shape
// the library reads. We pin `maxWidth` to the user's chosen width too, so the
// saved shape remains defensive if DataViews changes its table sizing again.
export function withColumnWidth( view, fieldId, width, fieldType ) {
	const clamped = clampWidth( width, fieldType );
	const layout = view?.layout ?? {};
	const styles = layout.styles ?? {};
	const previous = styles[ fieldId ] ?? {};
	const nextEntry = {
		...previous,
		width: clamped,
		minWidth: getMinWidth( fieldType ),
		maxWidth: clamped,
	};
	return {
		...view,
		layout: {
			...layout,
			styles: { ...styles, [ fieldId ]: nextEntry },
		},
	};
}

// Moves a column from one index to another in `view.fields`. Every column
// (including the title) reorders freely — the title's only constraint is
// visibility, enforced via `enableHiding: false` on the field and the
// `normalizeView` re-prepend if it ever drops out of `view.fields`.
export function withColumnOrder( view, fromIndex, toIndex ) {
	const fields = Array.isArray( view?.fields ) ? view.fields.slice() : [];
	if (
		fromIndex < 0 ||
		fromIndex >= fields.length ||
		toIndex < 0 ||
		toIndex >= fields.length ||
		fromIndex === toIndex
	) {
		return view;
	}
	const [ movingId ] = fields.splice( fromIndex, 1 );
	fields.splice( toIndex, 0, movingId );
	return { ...view, fields };
}
