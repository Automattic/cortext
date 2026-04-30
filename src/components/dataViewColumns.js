/**
 * Helpers for the DataView block's table column interactions: resize and
 * reorder. The shape used to persist widths is the one `@wordpress/dataviews`
 * already reads at render time — `view.layout.styles[fieldId] = { width,
 * minWidth, maxWidth }` — so the library applies the values without any
 * custom render path. Order persists on `view.fields`, also library-native.
 */

export const TITLE_FIELD_ID = 'title';

// Title cells hold long row identifiers, so they need more headroom than the
// generic columns. The cap matches what feels right at typical editor widths
// without monopolising the table.
export const MIN_TITLE_WIDTH = 180;
export const MIN_COLUMN_WIDTH = 120;
export const MAX_COLUMN_WIDTH = 640;

export function getMinWidth( fieldId, { titleId = TITLE_FIELD_ID } = {} ) {
	return fieldId === titleId ? MIN_TITLE_WIDTH : MIN_COLUMN_WIDTH;
}

export function clampWidth( width, fieldId, options ) {
	const min = getMinWidth( fieldId, options );
	const value = Number( width );
	if ( ! Number.isFinite( value ) ) {
		return min;
	}
	return Math.max( min, Math.min( MAX_COLUMN_WIDTH, Math.round( value ) ) );
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
			const clamped = clampWidth( entry.width, id, { titleId } );
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
// the library reads, with min/max anchored to the same constants the resize
// drag enforces.
export function withColumnWidth( view, fieldId, width, options = {} ) {
	const titleId = options.titleId ?? TITLE_FIELD_ID;
	const clamped = clampWidth( width, fieldId, { titleId } );
	const layout = view?.layout ?? {};
	const styles = layout.styles ?? {};
	const previous = styles[ fieldId ] ?? {};
	const min = getMinWidth( fieldId, { titleId } );
	const nextEntry = {
		...previous,
		width: clamped,
		minWidth: min,
		maxWidth: MAX_COLUMN_WIDTH,
	};
	return {
		...view,
		layout: {
			...layout,
			styles: { ...styles, [ fieldId ]: nextEntry },
		},
	};
}

// Moves a column from one index to another in `view.fields`. The title id is
// pinned to position 0 — if the move would dislodge it (or leave a non-title
// in front), it's re-prepended on the way out. Mirrors Notion's behavior:
// the Name column never moves and never disappears.
export function withColumnOrder( view, fromIndex, toIndex, options = {} ) {
	const titleId = options.titleId ?? TITLE_FIELD_ID;
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
	const movingId = fields[ fromIndex ];
	if ( movingId === titleId ) {
		return view;
	}
	fields.splice( fromIndex, 1 );
	let insertAt = toIndex;
	// Don't allow a drop that would land left of the title column.
	const titleIndex = fields.indexOf( titleId );
	if ( titleIndex !== -1 && insertAt <= titleIndex ) {
		insertAt = titleIndex + 1;
	}
	fields.splice( insertAt, 0, movingId );
	return { ...view, fields };
}
