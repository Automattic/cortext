import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { addQueryArgs } from '@wordpress/url';
import apiFetch from '@wordpress/api-fetch';

import { useCollectionRowsInvalidation } from './rowInvalidation';

// tech-debt.md#2: rows live outside core-data, so this hook manages
// its own fetch state and exposes a manual refresh() handle.

const CLIENT_PER_PAGE = 100;
const CLIENT_PAGE_FETCH_CONCURRENCY = 4;
const MANUAL_SORT_ID = 'manual';

function serverFieldInfo( field ) {
	return {
		filterable: field.filterable === true,
		sortable: field.sortable === true,
		type: field.cortextFieldType ?? field.cortextType ?? field.type,
		operators: Array.isArray( field.operators )
			? field.operators
			: undefined,
	};
}

function fieldInfoMap( fields = [] ) {
	return new Map( fields.map( ( f ) => [ f.id, serverFieldInfo( f ) ] ) );
}

function hasCalculations( view ) {
	return Object.values( view?.calculations ?? {} ).some( Boolean );
}

function pageNumber( value, fallback = 1 ) {
	const number = Number( value );
	return Number.isFinite( number ) && number >= 1
		? Math.floor( number )
		: fallback;
}

function perPageNumber( value, fallback = 25 ) {
	const number = Number( value );
	if ( ! Number.isFinite( number ) || number < 1 ) {
		return fallback;
	}
	return Math.min( 100, Math.floor( number ) );
}

function isServerSupportedSort( sort, fieldInfo ) {
	if ( ! sort?.field ) {
		return true;
	}
	if ( sort.field === MANUAL_SORT_ID ) {
		return true;
	}
	const info = fieldInfo.get( sort.field );
	return info?.sortable === true;
}

function viewForServer( view ) {
	if ( view?.sort?.field !== MANUAL_SORT_ID ) {
		return view;
	}
	return { ...( view ?? {} ), sort: null };
}

function filterInfo( filter, fieldInfo ) {
	return filter?.field ? fieldInfo.get( filter.field ) : undefined;
}

function hasUsableFilterValue( filter ) {
	const operator = filter?.operator;
	if (
		operator === 'isEmpty' ||
		operator === 'isNotEmpty' ||
		operator === 'isChecked' ||
		operator === 'isUnchecked'
	) {
		return true;
	}
	if ( operator === 'between' ) {
		return Array.isArray( filter.value ) && filter.value.length === 2;
	}
	if ( operator === 'isAny' || operator === 'isNone' ) {
		return Array.isArray( filter.value ) && filter.value.length > 0;
	}
	return filter?.value !== undefined && ! Array.isArray( filter.value );
}

function booleanFilterValue( value ) {
	if ( value === true || value === 1 ) {
		return true;
	}
	if ( value === false || value === 0 || value === '' ) {
		return false;
	}
	if ( typeof value !== 'string' ) {
		return undefined;
	}

	const normalized = value.trim().toLowerCase();
	if ( [ '1', 'true', 'yes', 'on' ].includes( normalized ) ) {
		return true;
	}
	if ( [ '0', 'false', 'no', 'off' ].includes( normalized ) ) {
		return false;
	}
	return undefined;
}

function normalizeFilterForServer( filter, fieldInfo ) {
	const info = filterInfo( filter, fieldInfo );
	if (
		( info?.type === 'select' || info?.type === 'multiselect' ) &&
		( filter?.operator === 'isAny' || filter?.operator === 'isNone' ) &&
		filter.value !== undefined &&
		! Array.isArray( filter.value )
	) {
		return { ...filter, value: [ filter.value ] };
	}

	if (
		info?.type === 'select' &&
		( filter?.operator === 'is' || filter?.operator === 'isNot' ) &&
		Array.isArray( filter.value ) &&
		filter.value.length === 1
	) {
		return { ...filter, value: filter.value[ 0 ] };
	}

	if (
		info?.type !== 'checkbox' ||
		( filter?.operator !== 'is' && filter?.operator !== 'isNot' )
	) {
		return filter;
	}

	const value = booleanFilterValue( filter.value );
	if ( value === undefined ) {
		return filter;
	}

	const checked = filter.operator === 'is' ? value : ! value;
	const { value: _value, ...normalized } = filter;
	return {
		...normalized,
		operator: checked ? 'isChecked' : 'isUnchecked',
	};
}

function leafFilterResult( filter, fieldInfo ) {
	const info = filterInfo( filter, fieldInfo );
	if (
		! info?.filterable ||
		! filter?.operator ||
		! Array.isArray( info.operators ) ||
		! info.operators.includes( filter.operator )
	) {
		return { node: null, hasUnsupported: true, alwaysTrue: false };
	}

	if ( ! hasUsableFilterValue( filter ) ) {
		return { node: null, hasUnsupported: false, alwaysTrue: true };
	}

	return { node: filter, hasUnsupported: false, alwaysTrue: false };
}

function serverFilterNode( filter, fieldInfo ) {
	if ( ! filter || typeof filter !== 'object' ) {
		return { node: null, hasUnsupported: true, alwaysTrue: false };
	}

	const isGroup = Boolean( filter.relation || filter.filters );
	if ( ! isGroup ) {
		const normalized = normalizeFilterForServer( filter, fieldInfo );
		return leafFilterResult( normalized, fieldInfo );
	}

	const relation = String( filter.relation ?? 'AND' ).toUpperCase();
	if ( relation !== 'AND' && relation !== 'OR' ) {
		return { node: null, hasUnsupported: true, alwaysTrue: false };
	}
	if ( ! Array.isArray( filter.filters ) || filter.filters.length === 0 ) {
		return { node: null, hasUnsupported: true, alwaysTrue: false };
	}

	const children = [];
	let hasUnsupported = false;
	let hasAlwaysTrue = false;
	for ( const child of filter.filters ) {
		const result = serverFilterNode( child, fieldInfo );
		if ( result.node ) {
			children.push( result.node );
		}
		if ( result.hasUnsupported ) {
			hasUnsupported = true;
		}
		if ( result.alwaysTrue ) {
			hasAlwaysTrue = true;
		}
	}

	// DataViews' final client pass only understands flat leaf filters.
	// Forward grouped filters only when the whole tree can run server-side.
	if ( hasUnsupported ) {
		return { node: null, hasUnsupported: true, alwaysTrue: false };
	}
	if ( relation === 'OR' && hasAlwaysTrue ) {
		return { node: null, hasUnsupported: false, alwaysTrue: true };
	}
	if ( children.length === 0 ) {
		return { node: null, hasUnsupported: false, alwaysTrue: true };
	}
	return {
		node: { relation, filters: children },
		hasUnsupported: false,
		alwaysTrue: false,
	};
}

function serverFilterResult( filters, fieldInfo ) {
	if ( ! Array.isArray( filters ) ) {
		return { filters: [], hasUnsupported: false };
	}

	const supported = [];
	let hasUnsupported = false;
	for ( const filter of filters ) {
		const result = serverFilterNode( filter, fieldInfo );
		if ( result.node ) {
			supported.push( result.node );
		}
		if ( result.hasUnsupported ) {
			hasUnsupported = true;
		}
	}
	return { filters: supported, hasUnsupported };
}

function addValueArgs( args, prefix, value ) {
	if ( value === undefined ) {
		return;
	}
	if ( Array.isArray( value ) ) {
		value.forEach( ( item, i ) => {
			args[ `${ prefix }[value][${ i }]` ] = item;
		} );
		return;
	}
	args[ `${ prefix }[value]` ] = value;
}

function addFilterArgs( args, prefix, filter ) {
	if ( filter.relation && Array.isArray( filter.filters ) ) {
		args[ `${ prefix }[relation]` ] = filter.relation;
		filter.filters.forEach( ( child, i ) => {
			addFilterArgs( args, `${ prefix }[filters][${ i }]`, child );
		} );
		return;
	}

	args[ `${ prefix }[field]` ] = filter.field;
	args[ `${ prefix }[operator]` ] = filter.operator;
	addValueArgs( args, prefix, filter.value );
}

function buildClientQueryArgs( collectionId ) {
	return {
		collection: collectionId,
		page: 1,
		per_page: CLIENT_PER_PAGE,
	};
}

export function buildQueryArgs( collectionId, view, fields = [] ) {
	const fieldInfo = fieldInfoMap( fields );
	const serverView = isServerSupportedSort( view?.sort, fieldInfo )
		? view
		: { ...( view ?? {} ), sort: null };
	return buildServerQueryArgs(
		collectionId,
		viewForServer( serverView ),
		serverFilterResult( view?.filters, fieldInfo ).filters,
		fields
	);
}

// Builds the fields[] projection for the server. Return null when sending it
// would not trim the row payload: before the visibility seeder fills
// `view.fields`, or after it has selected every custom field. Grid/list can
// request layout-specific fields without adding them to the table columns.
// Sorting also keeps column reorders from changing the key.
function projectedFields( view, fields ) {
	if ( ! Array.isArray( view?.fields ) || view.fields.length === 0 ) {
		return null;
	}
	const requested = new Set( view.fields );
	const activeLayoutFields = view?.fieldsByType?.[ view?.type ];
	if ( Array.isArray( activeLayoutFields ) ) {
		activeLayoutFields.forEach( ( id ) => requested.add( id ) );
	}
	const customFieldIds = fields
		.filter( ( f ) => typeof f?.id === 'string' && /^field-/.test( f.id ) )
		.map( ( f ) => f.id );
	const skipsCustomField = customFieldIds.some(
		( id ) => ! requested.has( id )
	);
	if ( ! skipsCustomField ) {
		return null;
	}
	return [ ...requested ].sort();
}

function buildServerQueryArgs( collectionId, view, filters = [], fields = [] ) {
	const args = {
		collection: collectionId,
		page: pageNumber( view?.page ),
		per_page: perPageNumber( view?.perPage ),
	};

	if ( view?.search ) {
		args.search = view.search;
	}

	if ( view?.sort?.field ) {
		args[ 'sort[field]' ] = view.sort.field;
		args[ 'sort[direction]' ] =
			view.sort.direction === 'desc' ? 'desc' : 'asc';
	}

	filters.forEach( ( filter, i ) => {
		addFilterArgs( args, `filters[${ i }]`, filter );
	} );

	const projection = projectedFields( view, fields );
	if ( projection ) {
		projection.forEach( ( key, i ) => {
			args[ `fields[${ i }]` ] = key;
		} );
	}

	return args;
}

function customSchemaFieldIds( fields = [] ) {
	return fields
		.map( ( field ) => field?.id )
		.filter( ( id ) => typeof id === 'string' && /^field-/.test( id ) );
}

function projectionValues( args = {} ) {
	return Object.keys( args )
		.filter( ( key ) => /^fields\[\d+\]$/.test( key ) )
		.sort(
			( a, b ) =>
				Number( a.match( /\d+/ )?.[ 0 ] ?? 0 ) -
				Number( b.match( /\d+/ )?.[ 0 ] ?? 0 )
		)
		.map( ( key ) => args[ key ] );
}

function argsWithoutProjection( args = {} ) {
	return Object.fromEntries(
		Object.entries( args ).filter(
			( [ key ] ) => ! /^fields\[\d+\]$/.test( key )
		)
	);
}

function sameArgsExceptProjection( a, b ) {
	return (
		JSON.stringify( argsWithoutProjection( a ) ) ===
		JSON.stringify( argsWithoutProjection( b ) )
	);
}

function isNewFieldProjectionExpansion( previous, next ) {
	if (
		! previous ||
		previous.collectionId !== next.collectionId ||
		previous.mode !== next.mode ||
		previous.refreshKey !== next.refreshKey ||
		! sameArgsExceptProjection( previous.args, next.args )
	) {
		return false;
	}

	const previousProjection = projectionValues( previous.args );
	const nextProjection = projectionValues( next.args );
	if (
		previousProjection.length === 0 ||
		nextProjection.length <= previousProjection.length
	) {
		return false;
	}

	const previousProjected = new Set( previousProjection );
	const nextProjected = new Set( nextProjection );
	if ( previousProjection.some( ( id ) => ! nextProjected.has( id ) ) ) {
		return false;
	}

	const previousFieldIds = new Set( previous.fieldIds );
	const addedProjectionIds = nextProjection.filter(
		( id ) => ! previousProjected.has( id )
	);
	return addedProjectionIds.every(
		( id ) => /^field-/.test( id ) && ! previousFieldIds.has( id )
	);
}

export function buildQueryPlan(
	collectionId,
	view,
	fields = [],
	options = {}
) {
	const fieldInfo = fieldInfoMap( fields );
	const filterResult = serverFilterResult( view?.filters, fieldInfo );
	const canUseServer =
		! options.forceClient &&
		! hasCalculations( view ) &&
		isServerSupportedSort( view?.sort, fieldInfo ) &&
		! filterResult.hasUnsupported;

	if ( ! canUseServer ) {
		return {
			mode: 'client',
			args: buildClientQueryArgs( collectionId ),
		};
	}

	return {
		mode: 'server',
		args: buildServerQueryArgs(
			collectionId,
			viewForServer( view ),
			filterResult.filters,
			fields
		),
	};
}

function totalPagesNumber( value ) {
	const number = Number( value );
	return Number.isFinite( number ) && number >= 1 ? Math.floor( number ) : 1;
}

async function fetchRowsPage( args ) {
	return apiFetch( {
		path: addQueryArgs( '/cortext/v1/rows', args ),
	} );
}

export default function useCollectionRows(
	collectionId,
	view,
	fields = [],
	options = {}
) {
	const [ state, setState ] = useState( {
		data: [],
		collection: null,
		paginationInfo: { totalItems: 0, totalPages: 0 },
		isLoading: false,
		hasResolved: false,
		error: null,
	} );
	const [ refreshKey, setRefreshKey ] = useState( 0 );

	const stateRef = useRef( state );
	stateRef.current = state;
	const requestIdRef = useRef( 0 );
	const querySnapshotRef = useRef( null );
	const queryPlan = collectionId
		? buildQueryPlan( collectionId, view, fields, options )
		: null;
	const queryKey = collectionId
		? JSON.stringify( {
				args: queryPlan.args,
				mode: queryPlan.mode,
		  } )
		: null;

	// tech-debt.md#2: callers POST via apiFetch and bump refresh() to
	// re-read. With rows in core-data this whole counter goes away.
	const refresh = useCallback( () => {
		setRefreshKey( ( key ) => key + 1 );
	}, [] );

	// Lets callers reorder/replace `data` locally for optimistic updates.
	// The next `refresh` (or any natural refetch) overwrites this with the
	// server's truth, so callers don't have to undo their own change on
	// success. They do have to revert on failure: `mutateRows(prevSnapshot)`.
	const mutateRows = useCallback( ( updater ) => {
		setState( ( prev ) => {
			const nextData =
				typeof updater === 'function' ? updater( prev.data ) : updater;
			if ( nextData === prev.data ) {
				return prev;
			}
			return { ...prev, data: nextData };
		} );
	}, [] );

	useCollectionRowsInvalidation( collectionId, refresh );

	useEffect( () => {
		if ( ! collectionId ) {
			querySnapshotRef.current = null;
			setState( {
				data: [],
				collection: null,
				paginationInfo: { totalItems: 0, totalPages: 0 },
				isLoading: false,
				hasResolved: false,
				error: null,
			} );
			return undefined;
		}

		const activeQueryPlan = queryPlan;
		const nextSnapshot = {
			collectionId,
			mode: activeQueryPlan.mode,
			args: activeQueryPlan.args,
			fieldIds: customSchemaFieldIds( fields ),
			refreshKey,
		};
		const canReuseRows =
			stateRef.current.hasResolved &&
			isNewFieldProjectionExpansion(
				querySnapshotRef.current,
				nextSnapshot
			);
		querySnapshotRef.current = nextSnapshot;

		if ( canReuseRows ) {
			requestIdRef.current += 1;
			setState( ( prev ) => ( {
				...prev,
				isLoading: false,
				hasResolved: true,
				error: null,
			} ) );
			return undefined;
		}

		const requestId = ++requestIdRef.current;

		setState( ( prev ) => ( {
			...prev,
			isLoading: true,
			hasResolved: false,
			error: null,
		} ) );

		async function loadRows() {
			try {
				const firstPage = await fetchRowsPage( activeQueryPlan.args );
				if ( requestId !== requestIdRef.current ) {
					return;
				}

				let body = firstPage;
				if ( activeQueryPlan.mode === 'client' ) {
					const totalPages = totalPagesNumber( firstPage.totalPages );
					const rows = Array.isArray( firstPage.rows )
						? [ ...firstPage.rows ]
						: [];
					const remainingPages = Array.from(
						{ length: totalPages - 1 },
						( _, index ) => index + 2
					);
					const remainingPageBodies = [];
					let nextPageIndex = 0;

					async function fetchNextPages() {
						while (
							nextPageIndex < remainingPages.length &&
							requestId === requestIdRef.current
						) {
							const index = nextPageIndex++;
							const page = remainingPages[ index ];
							const nextPage = await fetchRowsPage( {
								...activeQueryPlan.args,
								page,
							} );
							if ( requestId !== requestIdRef.current ) {
								return;
							}
							remainingPageBodies[ index ] = nextPage;
						}
					}

					const workerCount = Math.min(
						CLIENT_PAGE_FETCH_CONCURRENCY,
						remainingPages.length
					);
					await Promise.all(
						Array.from( { length: workerCount }, fetchNextPages )
					);
					if ( requestId !== requestIdRef.current ) {
						return;
					}

					remainingPageBodies.forEach( ( nextPage ) => {
						if ( Array.isArray( nextPage?.rows ) ) {
							rows.push( ...nextPage.rows );
						}
					} );

					body = { ...firstPage, rows };
				}

				setState( {
					data: Array.isArray( body.rows ) ? body.rows : [],
					collection: body.collection ?? null,
					paginationInfo: {
						totalItems: body.total ?? 0,
						totalPages: body.totalPages ?? 1,
					},
					isLoading: false,
					hasResolved: true,
					error: null,
				} );
			} catch ( error ) {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				setState( {
					data: [],
					collection: null,
					paginationInfo: { totalItems: 0, totalPages: 0 },
					isLoading: false,
					hasResolved: true,
					error,
				} );
			}
		}

		loadRows();

		return undefined;
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ collectionId, queryKey, refreshKey ] );

	return {
		...state,
		refresh,
		mutateRows,
		queryMode: queryPlan?.mode ?? 'client',
	};
}
