import { COVER_FIELD_ID, MIN_WIDTHS, TITLE_FIELD_ID } from './dataViewColumns';

// tech-debt.md#td-dataviews-view-state-shape: DataViews only carries the active layout shape. Cortext keeps
// per-layout buckets and hydrates the active shape before rendering.
export const DATA_VIEW_LAYOUT_TYPES = [ 'table', 'grid', 'list' ];
export const DATA_VIEW_FIELD_LAYOUT_TYPES = [ 'grid', 'list' ];
export const DEFAULT_GRID_PREVIEW_SIZE = 230;

export const DEFAULT_LAYOUTS = {
	table: { layout: { density: 'compact' } },
	grid: { layout: { previewSize: DEFAULT_GRID_PREVIEW_SIZE } },
	list: {},
};

const DEFAULT_TABLE_TITLE_WIDTH = 320;
const UNSUPPORTED_DATAVIEWS_KEYS = [ 'infiniteScrollEnabled', 'startPosition' ];

function isObject( value ) {
	return Boolean(
		value && typeof value === 'object' && ! Array.isArray( value )
	);
}

function normalizeType( type ) {
	return DATA_VIEW_LAYOUT_TYPES.includes( type ) ? type : 'table';
}

function cloneLayout( layout ) {
	return isObject( layout ) ? { ...layout } : {};
}

function withoutUnsupportedDataViewsState( view ) {
	const next = { ...view };
	if (
		! Object.prototype.hasOwnProperty.call( next, 'groupBy' ) &&
		typeof next.groupByField === 'string' &&
		next.groupByField
	) {
		next.groupBy = { field: next.groupByField, direction: 'asc' };
	}
	delete next.groupByField;
	for ( const key of UNSUPPORTED_DATAVIEWS_KEYS ) {
		delete next[ key ];
	}
	return next;
}

function layoutForTableDataViews(
	layout,
	{ applyDefaultTableTitleWidth = true } = {}
) {
	const nextLayout = cloneLayout( layout );
	if ( ! applyDefaultTableTitleWidth ) {
		return nextLayout;
	}

	const styles = isObject( nextLayout.styles )
		? { ...nextLayout.styles }
		: {};
	const titleStyle = isObject( styles[ TITLE_FIELD_ID ] )
		? { ...styles[ TITLE_FIELD_ID ] }
		: {};

	styles[ TITLE_FIELD_ID ] = {
		minWidth: MIN_WIDTHS.title,
		...titleStyle,
		width: titleStyle.width ?? DEFAULT_TABLE_TITLE_WIDTH,
	};

	return {
		...nextLayout,
		styles,
	};
}

function layoutForGridDataViews( layout ) {
	const sourceLayout = cloneLayout( layout );
	const nextLayout = {};
	const previewSize = Number( sourceLayout.previewSize );

	nextLayout.previewSize = Number.isFinite( previewSize )
		? previewSize
		: DEFAULT_GRID_PREVIEW_SIZE;

	if ( Array.isArray( sourceLayout.badgeFields ) ) {
		nextLayout.badgeFields = sourceLayout.badgeFields;
	}

	return nextLayout;
}

function defaultLayoutForType( type ) {
	return cloneLayout( DEFAULT_LAYOUTS[ type ]?.layout );
}

export function layoutForType( type, layout ) {
	const nextLayout = {
		...defaultLayoutForType( type ),
		...cloneLayout( layout ),
	};

	if ( type === 'grid' ) {
		return layoutForGridDataViews( nextLayout );
	}

	return nextLayout;
}

function uniqueFields( fields = [] ) {
	const seen = new Set();
	return fields.filter( ( fieldId ) => {
		if ( ! fieldId || seen.has( fieldId ) ) {
			return false;
		}
		seen.add( fieldId );
		return true;
	} );
}

function tableFields( fields = [] ) {
	const withoutTitle = uniqueFields( fields ).filter(
		( fieldId ) => fieldId !== TITLE_FIELD_ID
	);
	return [ TITLE_FIELD_ID, ...withoutTitle ];
}

function displayFields( fields = [] ) {
	return uniqueFields( fields ).filter(
		( fieldId ) => fieldId !== TITLE_FIELD_ID
	);
}

function layoutByTypeFromView( view = {} ) {
	const currentType = normalizeType( view?.type );
	const buckets = {};
	const stored = isObject( view?.layoutByType ) ? view.layoutByType : {};

	DATA_VIEW_LAYOUT_TYPES.forEach( ( type ) => {
		buckets[ type ] = layoutForType( type, stored[ type ] );
	} );

	if ( isObject( view?.layout ) ) {
		buckets[ currentType ] = layoutForType( currentType, {
			...buckets[ currentType ],
			...view.layout,
		} );
	}

	return buckets;
}

function fieldsByTypeFromView( view = {} ) {
	const buckets = {};
	const stored = isObject( view?.fieldsByType ) ? view.fieldsByType : {};

	DATA_VIEW_FIELD_LAYOUT_TYPES.forEach( ( type ) => {
		buckets[ type ] = Array.isArray( stored[ type ] )
			? displayFields( stored[ type ] )
			: [];
	} );

	return buckets;
}

function withActiveLayout( view, type, layoutByType, fieldsByType, options ) {
	const layout = cloneLayout( layoutByType[ type ] );
	const next = {
		...withoutUnsupportedDataViewsState( view ),
		type,
		layout,
		layoutByType,
		fieldsByType,
	};

	if ( type === 'table' ) {
		next.titleField = TITLE_FIELD_ID;
		next.showTitle = false;
		next.layout = layoutForTableDataViews( next.layout, options );
		delete next.mediaField;
		delete next.descriptionField;
		return next;
	}

	next.titleField = TITLE_FIELD_ID;
	delete next.showTitle;
	if ( type === 'grid' && ! next.mediaField ) {
		next.mediaField = COVER_FIELD_ID;
	}
	next.fields = fieldsByType[ type ] ?? [];
	return next;
}

export function adaptViewForDataViews( view = {}, options = {} ) {
	const type = normalizeType( view?.type );
	return withActiveLayout(
		view,
		type,
		layoutByTypeFromView( view ),
		fieldsByTypeFromView( view ),
		options
	);
}

export function mergeDataViewsChange( previousView = {}, nextView = {} ) {
	const previousType = normalizeType( previousView?.type );
	const nextType = normalizeType( nextView?.type );
	const layoutByType = layoutByTypeFromView( previousView );
	const fieldsByType = fieldsByTypeFromView( previousView );

	if ( isObject( nextView?.fieldsByType ) ) {
		DATA_VIEW_FIELD_LAYOUT_TYPES.forEach( ( type ) => {
			if ( Array.isArray( nextView.fieldsByType[ type ] ) ) {
				fieldsByType[ type ] = displayFields(
					nextView.fieldsByType[ type ]
				);
			}
		} );
	}

	if ( isObject( previousView?.layout ) ) {
		layoutByType[ previousType ] = layoutForType(
			previousType,
			previousView.layout
		);
	}
	if ( previousType === nextType && isObject( nextView?.layout ) ) {
		layoutByType[ nextType ] = layoutForType( nextType, nextView.layout );
	}

	const canonicalFields = tableFields(
		Array.isArray( previousView?.fields ) ? previousView.fields : []
	);
	let fields = canonicalFields;
	if (
		nextType === 'table' &&
		previousType === nextType &&
		Array.isArray( nextView?.fields )
	) {
		fields = tableFields( nextView.fields );
	}
	if (
		nextType !== 'table' &&
		previousType === nextType &&
		Array.isArray( nextView?.fields )
	) {
		fieldsByType[ nextType ] = displayFields( nextView.fields );
	}

	const next = {
		...withoutUnsupportedDataViewsState( previousView ),
		...withoutUnsupportedDataViewsState( nextView ),
		type: nextType,
		fields,
		fieldsByType,
		layout: layoutForType( nextType, layoutByType[ nextType ] ),
		layoutByType,
	};

	if ( next.titleField === TITLE_FIELD_ID ) {
		delete next.titleField;
	}
	if ( nextType !== 'table' ) {
		delete next.showTitle;
	}
	for ( const key of UNSUPPORTED_DATAVIEWS_KEYS ) {
		delete next[ key ];
	}

	return next;
}
