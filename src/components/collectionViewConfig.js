import { __, sprintf } from '@wordpress/i18n';

import { DEFAULT_GRID_PREVIEW_SIZE, DEFAULT_LAYOUTS } from './dataViewAdapter';
import { normalizeView } from './dataViewColumns';

export const DEFAULT_VIEW_SLUG = 'default';
export const DEFAULT_VIEW_TITLE = __( 'Table', 'cortext' );

export function createDefaultView( overrides = {} ) {
	return {
		type: 'table',
		fields: [],
		sort: null,
		filters: [],
		search: '',
		calculations: {},
		perPage: 25,
		layout: { density: 'compact' },
		layoutByType: {
			table: { density: 'compact' },
			grid: { previewSize: DEFAULT_GRID_PREVIEW_SIZE },
			list: {},
		},
		fieldsByType: {
			grid: [],
			list: [],
		},
		rowDetailMode: 'side',
		...overrides,
	};
}

// Same shape as DataViews `defaultLayouts` and core's entity view config:
// each entry is the partial view applied when switching to that layout.
export function createDefaultLayouts() {
	return cloneValue( DEFAULT_LAYOUTS );
}

function cloneValue( value ) {
	if ( value === undefined ) {
		return undefined;
	}
	return JSON.parse( JSON.stringify( value ) );
}

function isPlainObject( value ) {
	return Boolean(
		value && typeof value === 'object' && ! Array.isArray( value )
	);
}

// PHP encodes empty associative arrays as `[]`, so object-shaped keys can
// come back from the collection views endpoint as empty lists.
function asObject( value ) {
	return isPlainObject( value ) ? value : {};
}

function withObjectKeys( value, keys ) {
	const next = { ...value };
	keys.forEach( ( key ) => {
		if ( key in next ) {
			next[ key ] = asObject( next[ key ] );
		}
	} );
	return next;
}

function withObjectValues( value ) {
	return Object.fromEntries(
		Object.entries( asObject( value ) ).map( ( [ key, entry ] ) => [
			key,
			asObject( entry ),
		] )
	);
}

function normalizeObjectShapes( view ) {
	if ( ! isPlainObject( view ) ) {
		return view;
	}
	const next = withObjectKeys( view, [ 'calculations', 'layout' ] );
	if ( 'layout' in next ) {
		next.layout = withObjectKeys( next.layout, [ 'styles' ] );
	}
	if ( 'layoutByType' in next ) {
		next.layoutByType = withObjectValues( next.layoutByType );
	}
	return next;
}

function trimTitle( title ) {
	const trimmed = String( title ?? '' ).trim();
	return trimmed || DEFAULT_VIEW_TITLE;
}

function mergeView( defaultView, view ) {
	const base = isPlainObject( defaultView ) ? defaultView : {};
	const override = isPlainObject( view ) ? view : {};
	return {
		...base,
		...override,
		layout: {
			...( isPlainObject( base.layout ) ? base.layout : {} ),
			...( isPlainObject( override.layout ) ? override.layout : {} ),
		},
	};
}

function toPage( value ) {
	const page = Number( value ?? 1 );
	return Number.isFinite( page ) && page > 0 ? page : 1;
}

// The current page is the only view state that is not saved: every view
// opens on its first page. Search is part of the saved view.
export function stripViewRuntimeState( view ) {
	if ( ! isPlainObject( view ) ) {
		return view;
	}
	const next = { ...view };
	delete next.page;
	return next;
}

export function getViewRuntimeState( view ) {
	return { page: toPage( view?.page ) };
}

export function applyViewRuntimeState( view, runtimeState = {} ) {
	return { ...view, page: toPage( runtimeState.page ?? view?.page ) };
}

export function nextViewSlug( viewList = [] ) {
	const taken = new Set( viewList.map( ( view ) => view.slug ) );
	let index = 1;
	let slug = `view-${ index }`;
	while ( taken.has( slug ) || slug === DEFAULT_VIEW_SLUG ) {
		index += 1;
		slug = `view-${ index }`;
	}
	return slug;
}

export function uniqueViewTitle( baseTitle, viewList = [] ) {
	const base = trimTitle( baseTitle );
	const taken = new Set(
		viewList.map( ( view ) => String( view.title ?? '' ).trim() )
	);
	if ( ! taken.has( base ) ) {
		return base;
	}
	let index = 2;
	let title = sprintf(
		/* translators: 1: duplicated view title, 2: numeric suffix */
		__( '%1$s %2$d', 'cortext' ),
		base,
		index
	);
	while ( taken.has( title ) ) {
		index += 1;
		title = sprintf(
			/* translators: 1: duplicated view title, 2: numeric suffix */
			__( '%1$s %2$d', 'cortext' ),
			base,
			index
		);
	}
	return title;
}

// `view` seeds the single named view. `default_view` stays the plain default
// so settings a view later removes are not merged back in from it.
export function createDefaultViewConfig(
	view = createDefaultView(),
	defaultView = createDefaultView()
) {
	return {
		default_view: stripViewRuntimeState( cloneValue( defaultView ) ),
		default_layouts: createDefaultLayouts(),
		active_view: DEFAULT_VIEW_SLUG,
		view_list: [
			{
				slug: DEFAULT_VIEW_SLUG,
				title: DEFAULT_VIEW_TITLE,
				view: stripViewRuntimeState( cloneValue( view ) ),
			},
		],
	};
}

export function normalizeViewConfig( rawViewConfig, options = {} ) {
	const rawViews = Array.isArray( rawViewConfig?.view_list )
		? rawViewConfig.view_list
		: [];
	const defaultView = stripViewRuntimeState(
		mergeView(
			createDefaultView(),
			normalizeObjectShapes(
				cloneValue( asObject( rawViewConfig?.default_view ) )
			)
		)
	);
	const defaultLayouts = isPlainObject( rawViewConfig?.default_layouts )
		? Object.fromEntries(
				Object.entries(
					withObjectValues(
						cloneValue( rawViewConfig.default_layouts )
					)
				).map( ( [ type, entry ] ) => [
					type,
					normalizeObjectShapes( entry ),
				] )
		  )
		: createDefaultLayouts();
	const viewList = [];
	const usedSlugs = new Set();

	for ( const rawView of rawViews ) {
		if ( ! rawView || typeof rawView !== 'object' ) {
			continue;
		}

		let rawSlug = DEFAULT_VIEW_SLUG;
		if ( typeof rawView.slug === 'string' && rawView.slug.trim() ) {
			rawSlug = rawView.slug.trim();
		} else if ( viewList.length > 0 ) {
			rawSlug = nextViewSlug( viewList );
		}
		const slug = usedSlugs.has( rawSlug )
			? nextViewSlug( viewList )
			: rawSlug;
		const view = isPlainObject( rawView.view )
			? stripViewRuntimeState(
					mergeView(
						defaultView,
						normalizeObjectShapes( cloneValue( rawView.view ) )
					)
			  )
			: cloneValue( defaultView );

		usedSlugs.add( slug );
		viewList.push( {
			slug,
			title: trimTitle( rawView.title ),
			view,
		} );
	}

	if ( viewList.length === 0 ) {
		const legacyView = isPlainObject( options.legacyView )
			? mergeView( defaultView, cloneValue( options.legacyView ) )
			: defaultView;
		return createDefaultViewConfig( legacyView, defaultView );
	}

	const rawActiveView = rawViewConfig?.active_view;
	const activeView = viewList.some( ( view ) => view.slug === rawActiveView )
		? rawActiveView
		: viewList[ 0 ].slug;

	return {
		default_view: defaultView,
		default_layouts: defaultLayouts,
		active_view: activeView,
		view_list: viewList,
	};
}

export function prepareViewConfigForStorage( viewConfig ) {
	const normalized = normalizeViewConfig( viewConfig );
	return {
		...normalized,
		default_view: stripViewRuntimeState( normalized.default_view ),
		view_list: normalized.view_list.map( ( viewEntry ) => ( {
			...viewEntry,
			view: stripViewRuntimeState( viewEntry.view ),
		} ) ),
	};
}

export function getActiveViewEntry( viewConfig ) {
	const normalized = normalizeViewConfig( viewConfig );
	return (
		normalized.view_list.find(
			( viewEntry ) => viewEntry.slug === normalized.active_view
		) ?? normalized.view_list[ 0 ]
	);
}

export function getActiveView( viewConfig ) {
	const normalized = normalizeViewConfig( viewConfig );
	const activeView = getActiveViewEntry( normalized );
	return mergeView( normalized.default_view, activeView.view );
}

export function updateActiveView( viewConfig, nextView ) {
	const normalized = normalizeViewConfig( viewConfig );
	return {
		...normalized,
		view_list: normalized.view_list.map( ( viewEntry ) =>
			viewEntry.slug === normalized.active_view
				? {
						...viewEntry,
						view: stripViewRuntimeState( cloneValue( nextView ) ),
				  }
				: viewEntry
		),
	};
}

export function setActiveView( viewConfig, slug ) {
	const normalized = normalizeViewConfig( viewConfig );
	if ( ! normalized.view_list.some( ( view ) => view.slug === slug ) ) {
		return normalized;
	}
	return { ...normalized, active_view: slug };
}

export function addNamedView( viewConfig ) {
	const normalized = normalizeViewConfig( viewConfig );
	const slug = nextViewSlug( normalized.view_list );
	const title = uniqueViewTitle(
		__( 'View', 'cortext' ),
		normalized.view_list
	);
	return {
		...normalized,
		active_view: slug,
		view_list: [
			...normalized.view_list,
			{ slug, title, view: stripViewRuntimeState( createDefaultView() ) },
		],
	};
}

export function renameActiveView( viewConfig, title ) {
	const normalized = normalizeViewConfig( viewConfig );
	return {
		...normalized,
		view_list: normalized.view_list.map( ( viewEntry ) =>
			viewEntry.slug === normalized.active_view
				? { ...viewEntry, title: trimTitle( title ) }
				: viewEntry
		),
	};
}

export function duplicateActiveView( viewConfig ) {
	const normalized = normalizeViewConfig( viewConfig );
	const sourceIndex = normalized.view_list.findIndex(
		( viewEntry ) => viewEntry.slug === normalized.active_view
	);
	if ( sourceIndex < 0 ) {
		return normalized;
	}

	const source = normalized.view_list[ sourceIndex ];
	const slug = nextViewSlug( normalized.view_list );
	const copy = {
		slug,
		title: uniqueViewTitle(
			sprintf(
				/* translators: %s: source view title */
				__( '%s copy', 'cortext' ),
				source.title
			),
			normalized.view_list
		),
		view: stripViewRuntimeState(
			cloneValue( getActiveView( normalized ) )
		),
	};
	const viewList = normalized.view_list.slice();
	viewList.splice( sourceIndex + 1, 0, copy );

	return {
		...normalized,
		active_view: slug,
		view_list: viewList,
	};
}

export function deleteActiveView( viewConfig ) {
	const normalized = normalizeViewConfig( viewConfig );
	if ( normalized.view_list.length <= 1 ) {
		return normalized;
	}

	const activeIndex = normalized.view_list.findIndex(
		( viewEntry ) => viewEntry.slug === normalized.active_view
	);
	if ( activeIndex < 0 ) {
		return normalized;
	}

	const viewList = normalized.view_list.filter(
		( viewEntry ) => viewEntry.slug !== normalized.active_view
	);
	const nextActive =
		viewList[ Math.min( activeIndex, viewList.length - 1 ) ] ??
		viewList[ 0 ];

	return {
		...normalized,
		active_view: nextActive.slug,
		view_list: viewList,
	};
}

export function moveActiveView( viewConfig, direction ) {
	const normalized = normalizeViewConfig( viewConfig );
	const from = normalized.view_list.findIndex(
		( viewEntry ) => viewEntry.slug === normalized.active_view
	);
	const to = from + direction;
	if ( from < 0 || to < 0 || to >= normalized.view_list.length ) {
		return normalized;
	}

	const viewList = normalized.view_list.slice();
	const [ moving ] = viewList.splice( from, 1 );
	viewList.splice( to, 0, moving );
	return { ...normalized, view_list: viewList };
}

export function normalizeViewConfigForFields(
	viewConfig,
	validIds,
	options = {}
) {
	const normalized = normalizeViewConfig( viewConfig );
	let changed = false;
	const defaultView = normalizeView(
		normalized.default_view,
		validIds,
		options
	);
	if ( defaultView !== normalized.default_view ) {
		changed = true;
	}
	const viewList = normalized.view_list.map( ( viewEntry ) => {
		const nextView = normalizeView( viewEntry.view, validIds, options );
		if ( nextView !== viewEntry.view ) {
			changed = true;
			return { ...viewEntry, view: nextView };
		}
		return viewEntry;
	} );

	return changed
		? { ...normalized, default_view: defaultView, view_list: viewList }
		: normalized;
}

export function viewConfigsEqual( a, b ) {
	return (
		JSON.stringify( prepareViewConfigForStorage( a ) ) ===
		JSON.stringify( prepareViewConfigForStorage( b ) )
	);
}

export function isInitialDefaultViewConfig( viewConfig ) {
	const normalized = normalizeViewConfig( viewConfig );
	const onlyView = normalized.view_list[ 0 ];
	return (
		normalized.view_list.length === 1 &&
		normalized.active_view === DEFAULT_VIEW_SLUG &&
		onlyView?.slug === DEFAULT_VIEW_SLUG &&
		onlyView?.title === DEFAULT_VIEW_TITLE &&
		viewConfigsEqual( normalized, createDefaultViewConfig() )
	);
}

export function shouldSeedViewConfigFromLegacyView( viewConfig, legacyView ) {
	if ( ! isPlainObject( legacyView ) ) {
		return false;
	}
	return (
		isInitialDefaultViewConfig( viewConfig ) &&
		! viewConfigsEqual(
			createDefaultViewConfig( legacyView ),
			createDefaultViewConfig()
		)
	);
}
