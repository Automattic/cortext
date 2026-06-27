import { Component, useState, useMemo, useCallback } from '@wordpress/element';
import { DataViews } from '@wordpress/dataviews/wp';
import { __ } from '@wordpress/i18n';

import usePublicRows, { isPublicSortSupported } from '../hooks/usePublicRows';
import { buildPublicFields } from '../hooks/publicFieldMapping';
import { normalizeView } from './dataViewColumns';
import {
	DEFAULT_LAYOUTS,
	adaptViewForDataViews,
	layoutForType,
	mergeDataViewsChange,
} from './dataViewAdapter';
import { filterSortAndPaginateWithGroups } from './groupedFilters';

const DEFAULT_PUBLIC_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	search: '',
	fields: [],
	sort: null,
	filters: [],
	layout: { density: 'compact' },
	layoutByType: {
		table: { density: 'compact' },
		grid: { ...DEFAULT_LAYOUTS.grid.layout },
		list: {},
	},
	fieldsByType: {
		grid: [],
		list: [],
	},
};

const PUBLIC_LAYOUT_TYPES = [ 'table', 'grid', 'list' ];
const DISPLAY_FIELD_LAYOUT_TYPES = [ 'grid', 'list' ];

function isObject( value ) {
	return Boolean(
		value && typeof value === 'object' && ! Array.isArray( value )
	);
}

function cloneObject( value ) {
	return isObject( value ) ? { ...value } : {};
}

function normalizeType( type ) {
	return PUBLIC_LAYOUT_TYPES.includes( type ) ? type : 'table';
}

function normalizeFieldIds( fields ) {
	if ( ! Array.isArray( fields ) ) {
		return [];
	}

	const seen = new Set();
	return fields
		.map( ( fieldId ) =>
			typeof fieldId === 'string' ? fieldId : String( fieldId ?? '' )
		)
		.filter( ( fieldId ) => {
			if ( ! fieldId || seen.has( fieldId ) ) {
				return false;
			}
			seen.add( fieldId );
			return true;
		} );
}

function normalizeSort( sort ) {
	if ( ! isObject( sort ) || ! sort.field ) {
		return null;
	}

	return {
		field: String( sort.field ),
		direction: sort.direction === 'asc' ? 'asc' : 'desc',
	};
}

function normalizeStyles( styles ) {
	if ( ! isObject( styles ) ) {
		return undefined;
	}

	const normalized = {};
	for ( const [ fieldId, style ] of Object.entries( styles ) ) {
		if ( isObject( style ) ) {
			normalized[ fieldId ] = { ...style };
		}
	}
	return Object.keys( normalized ).length > 0 ? normalized : undefined;
}

function normalizeLayout( layout, type ) {
	const normalized = layoutForType( type, cloneObject( layout ) );

	const styles = normalizeStyles( normalized.styles );
	if ( styles ) {
		normalized.styles = styles;
	} else {
		delete normalized.styles;
	}

	if ( normalized.badgeFields !== undefined ) {
		const badgeFields = normalizeFieldIds( normalized.badgeFields );
		if ( badgeFields.length > 0 ) {
			normalized.badgeFields = badgeFields;
		} else {
			delete normalized.badgeFields;
		}
	}

	return normalized;
}

function normalizeLayoutByType( layoutByType ) {
	const source = isObject( layoutByType ) ? layoutByType : {};
	return PUBLIC_LAYOUT_TYPES.reduce( ( buckets, type ) => {
		buckets[ type ] = normalizeLayout( source[ type ], type );
		return buckets;
	}, {} );
}

function normalizeFieldsByType( fieldsByType ) {
	const source = isObject( fieldsByType ) ? fieldsByType : {};
	return DISPLAY_FIELD_LAYOUT_TYPES.reduce( ( buckets, type ) => {
		buckets[ type ] = normalizeFieldIds( source[ type ] ).filter(
			( fieldId ) => fieldId !== 'title'
		);
		return buckets;
	}, {} );
}

function positiveInteger( value, fallback ) {
	const number = Number( value );
	return Number.isFinite( number ) && number > 0
		? Math.floor( number )
		: fallback;
}

export function normalizePublicView( view ) {
	const source = isObject( view ) ? view : {};
	const type = normalizeType( source.type ?? DEFAULT_PUBLIC_VIEW.type );
	const layoutByType = normalizeLayoutByType( source.layoutByType );

	return {
		...DEFAULT_PUBLIC_VIEW,
		...source,
		type,
		perPage: positiveInteger( source.perPage, DEFAULT_PUBLIC_VIEW.perPage ),
		page: positiveInteger( source.page, DEFAULT_PUBLIC_VIEW.page ),
		search:
			typeof source.search === 'string'
				? source.search
				: DEFAULT_PUBLIC_VIEW.search,
		fields: normalizeFieldIds( source.fields ),
		sort: normalizeSort( source.sort ),
		filters: Array.isArray( source.filters ) ? source.filters : [],
		layout: isObject( source.layout )
			? normalizeLayout( source.layout, type )
			: { ...layoutByType[ type ] },
		layoutByType,
		fieldsByType: normalizeFieldsByType( source.fieldsByType ),
	};
}

export function PublicDataViewErrorFallback() {
	return (
		<div className="cortext-public-data-view-error" role="status">
			{ __( "We couldn't load this collection view.", 'cortext' ) }
		</div>
	);
}

export class PublicDataViewErrorBoundary extends Component {
	constructor( props ) {
		super( props );
		this.state = { hasError: false };
	}

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	render() {
		if ( this.state.hasError ) {
			return <PublicDataViewErrorFallback />;
		}

		return this.props.children;
	}
}

export default function PublicDataView( { collectionId, view: initialView } ) {
	const [ view, setView ] = useState( () =>
		normalizePublicView( initialView )
	);
	const safeView = useMemo( () => normalizePublicView( view ), [ view ] );

	const {
		data,
		fields: fieldDefs,
		isLoading,
	} = usePublicRows( collectionId, safeView );

	const fields = useMemo(
		() => buildPublicFields( fieldDefs ),
		[ fieldDefs ]
	);

	// Reconcile view.fields against the live field set: drop stale IDs
	// and pin title first. When view.fields is empty (no saved field
	// order), seed it with every available field so DataViews' reorder
	// and hide/show controls have a complete list to work from. Skip
	// reconciliation while the REST response is in flight. The field
	// list is incomplete then, and seeding against it would lock out
	// fields that arrive later.
	const reconciledView = useMemo( () => {
		if ( isLoading || fieldDefs.length === 0 ) {
			return safeView;
		}
		const validIds = new Set( fields.map( ( f ) => f.id ) );
		const seeded =
			safeView.fields.length === 0
				? { ...safeView, fields: fields.map( ( f ) => f.id ) }
				: safeView;
		const normalized = normalizeView( seeded, validIds );
		if (
			normalized.sort?.field &&
			! isPublicSortSupported( normalized.sort, fieldDefs )
		) {
			return { ...normalized, sort: null };
		}
		return normalized;
	}, [ safeView, fields, isLoading, fieldDefs ] );

	const onChangeView = useCallback( ( next ) => {
		setView( ( current ) =>
			normalizePublicView(
				mergeDataViewsChange(
					normalizePublicView( current ),
					isObject( next ) ? next : {}
				)
			)
		);
	}, [] );

	const { data: dataFiltered, paginationInfo } = useMemo(
		() =>
			filterSortAndPaginateWithGroups(
				data,
				{ ...reconciledView, sort: null },
				fields
			),
		[ data, reconciledView, fields ]
	);
	const dataViewsView = useMemo(
		() => adaptViewForDataViews( reconciledView ),
		[ reconciledView ]
	);

	// Read-only: the public page shows the saved view, not an editable
	// explorer. Render just the layout and pagination and skip the search,
	// filter, and config toolbar.
	return (
		<DataViews
			data={ dataFiltered }
			fields={ fields }
			view={ dataViewsView }
			onChangeView={ onChangeView }
			paginationInfo={ paginationInfo }
			defaultLayouts={ DEFAULT_LAYOUTS }
			getItemId={ ( item ) => String( item.id ) }
			isLoading={ isLoading }
		>
			<DataViews.Layout />
			<DataViews.Pagination />
		</DataViews>
	);
}
