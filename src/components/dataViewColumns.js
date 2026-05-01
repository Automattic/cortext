/**
 * Helpers for the DataView block's table column interactions: resize and
 * reorder. The shape used to persist widths is the one `@wordpress/dataviews`
 * already reads at render time — `view.layout.styles[fieldId] = { width,
 * minWidth, maxWidth }` — so the library applies the values without any
 * custom render path. Order persists on `view.fields`, also library-native.
 */

export const TITLE_FIELD_ID = 'title';
export const MAX_COLUMN_WIDTH = 640;

// Per-type column-width floors. Calibrated against Notion's behavior: most
// columns shrink down to roughly eight characters of content plus padding;
// checkboxes shrink further so the column can show only the checkbox; date
// columns hold more glyphs by default so they need a touch more room.
// Keys are DataViews `field.type` values plus `title` for the title field
// (which doesn't carry a type).
export const MIN_WIDTHS = {
	title: 80,
	text: 80,
	email: 80,
	integer: 80,
	array: 80,
	date: 96,
	datetime: 96,
	// 32 gives the 24px WP CheckboxControl room inside our centered checkbox
	// cell while letting boolean columns behave like compact status markers.
	boolean: 32,
};
export const DEFAULT_MIN_WIDTH = 80;

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

	if ( ! fieldsChanged && ! stylesChanged ) {
		return view;
	}

	const nextLayout = { ...layout };
	if ( Object.keys( nextStyles ).length > 0 ) {
		nextLayout.styles = nextStyles;
	} else {
		delete nextLayout.styles;
	}

	return {
		...view,
		fields: nextFields,
		layout: nextLayout,
	};
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
