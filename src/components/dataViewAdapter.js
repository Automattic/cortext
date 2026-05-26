import { COVER_FIELD_ID, TITLE_FIELD_ID } from './dataViewColumns';

// tech-debt.md#60: DataViews only carries the active layout shape. Cortext keeps
// per-layout buckets and hydrates the active shape before rendering.
export const DATA_VIEW_LAYOUT_TYPES = [ 'table', 'grid', 'list' ];
export const DATA_VIEW_FIELD_LAYOUT_TYPES = [ 'grid', 'list' ];

export const DEFAULT_LAYOUTS = {
	table: { layout: { density: 'compact' } },
	grid: { layout: {} },
	list: {},
};

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

function defaultLayoutForType( type ) {
	return cloneLayout( DEFAULT_LAYOUTS[ type ]?.layout );
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
		buckets[ type ] = {
			...defaultLayoutForType( type ),
			...cloneLayout( stored[ type ] ),
		};
	} );

	if ( isObject( view?.layout ) ) {
		buckets[ currentType ] = {
			...buckets[ currentType ],
			...view.layout,
		};
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

function withActiveLayout( view, type, layoutByType, fieldsByType ) {
	const layout = cloneLayout( layoutByType[ type ] );
	const next = {
		...view,
		type,
		layout,
		layoutByType,
		fieldsByType,
	};

	if ( type === 'table' ) {
		delete next.titleField;
		delete next.mediaField;
		delete next.descriptionField;
		return next;
	}

	next.titleField = TITLE_FIELD_ID;
	if ( type === 'grid' && ! next.mediaField ) {
		next.mediaField = COVER_FIELD_ID;
	}
	next.fields = fieldsByType[ type ] ?? [];
	return next;
}

export function adaptViewForDataViews( view = {} ) {
	const type = normalizeType( view?.type );
	return withActiveLayout(
		view,
		type,
		layoutByTypeFromView( view ),
		fieldsByTypeFromView( view )
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
		layoutByType[ previousType ] = cloneLayout( previousView.layout );
	}
	if ( previousType === nextType && isObject( nextView?.layout ) ) {
		layoutByType[ nextType ] = cloneLayout( nextView.layout );
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
		...previousView,
		...nextView,
		type: nextType,
		fields,
		fieldsByType,
		layout: cloneLayout( layoutByType[ nextType ] ),
		layoutByType,
	};

	if ( next.titleField === TITLE_FIELD_ID ) {
		delete next.titleField;
	}

	return next;
}
