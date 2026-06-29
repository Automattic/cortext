import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';
import {
	useState,
	useMemo,
	useCallback,
	useEffect,
	useRef,
} from '@wordpress/element';

import { SIDEBAR_TREE_CHANGED_EVENT } from '../../hooks/sidebarTreeInvalidation';

export const ROOT_PARENT_ID = 0;
export const SIDEBAR_TREE_PER_PAGE = 20;
export const SIDEBAR_TREE_PREFERENCES_PATH =
	'/cortext/v1/sidebar-tree-preferences';

const DOCUMENTS_PATH = '/wp/v2/crtxt_documents';
const ACTIVE_STATUSES = [ 'draft', 'private', 'publish' ];
const TREE_FIELDS = [
	'id',
	'type',
	'parent',
	'menu_order',
	'status',
	'slug',
	'title',
	'meta',
	'cortext_defines_trait',
	'cortext_has_tree_children',
	'crtxt_trait',
];

const EMPTY_BRANCH = {
	records: [],
	page: 0,
	total: 0,
	totalPages: 0,
	isLoading: false,
	hasResolved: false,
	error: null,
};

function parentKey( parentId ) {
	const parsed = Number( parentId );
	return Number.isFinite( parsed ) && parsed > 0 ? Math.floor( parsed ) : 0;
}

function normalizeId( value ) {
	const parsed = Number( value );
	return Number.isFinite( parsed ) && parsed > 0 ? Math.floor( parsed ) : 0;
}

function normalizeIds( ids ) {
	if ( ! Array.isArray( ids ) ) {
		return [];
	}
	const seen = new Set();
	const out = [];
	ids.forEach( ( value ) => {
		const id = normalizeId( value );
		if ( id > 0 && ! seen.has( id ) ) {
			seen.add( id );
			out.push( id );
		}
	} );
	return out;
}

function headerNumber( response, name, fallback ) {
	const value = response?.headers?.get?.( name );
	const parsed = Number( value );
	return Number.isFinite( parsed ) && parsed >= 0 ? parsed : fallback;
}

function mergeRecords( current, incoming ) {
	const byId = new Map();
	const out = [];
	[ ...( current ?? [] ), ...( incoming ?? [] ) ].forEach( ( record ) => {
		const id = normalizeId( record?.id );
		if ( id < 1 ) {
			return;
		}
		if ( byId.has( id ) ) {
			const index = byId.get( id );
			out[ index ] = record;
			return;
		}
		byId.set( id, out.length );
		out.push( record );
	} );
	return out;
}

function branchHasMore( branch ) {
	return Boolean(
		branch?.hasResolved &&
			branch.totalPages > 0 &&
			branch.page < branch.totalPages
	);
}

function buildNodesForParent( parentId, branches, seen = new Set() ) {
	const branch = branches.get( parentKey( parentId ) );
	if ( ! branch?.records?.length ) {
		return [];
	}
	return branch.records.map( ( page ) => {
		const id = normalizeId( page.id );
		if ( id < 1 || seen.has( id ) ) {
			return { page, children: [], branch: branches.get( id ) };
		}
		const nextSeen = new Set( seen );
		nextSeen.add( id );
		return {
			page,
			children: buildNodesForParent( id, branches, nextSeen ),
			branch: branches.get( id ),
		};
	} );
}

function findRecordInBranches( branches, id ) {
	const targetId = normalizeId( id );
	if ( targetId < 1 ) {
		return null;
	}
	for ( const branch of branches.values() ) {
		const record = branch.records.find( ( item ) => item.id === targetId );
		if ( record ) {
			return record;
		}
	}
	return null;
}

function collectDescendantIds( parentId, branches ) {
	const normalizedParent = normalizeId( parentId );
	if ( normalizedParent < 1 ) {
		return new Set();
	}

	const childrenByParent = new Map();
	branches.forEach( ( branch ) => {
		branch.records.forEach( ( record ) => {
			const id = normalizeId( record?.id );
			if ( id < 1 ) {
				return;
			}
			const recordParent = parentKey( record?.parent );
			if ( ! childrenByParent.has( recordParent ) ) {
				childrenByParent.set( recordParent, [] );
			}
			childrenByParent.get( recordParent ).push( id );
		} );
	} );

	const descendants = new Set();
	const stack = [ ...( childrenByParent.get( normalizedParent ) ?? [] ) ];
	while ( stack.length > 0 ) {
		const id = stack.pop();
		if ( descendants.has( id ) ) {
			continue;
		}
		descendants.add( id );
		stack.push( ...( childrenByParent.get( id ) ?? [] ) );
	}
	return descendants;
}

export function buildSidebarTreeBranchPath( parentId, page = 1 ) {
	return addQueryArgs( DOCUMENTS_PATH, {
		context: 'edit',
		parent: parentKey( parentId ),
		page: Math.max( 1, Math.floor( Number( page ) || 1 ) ),
		per_page: SIDEBAR_TREE_PER_PAGE,
		status: ACTIVE_STATUSES,
		cortext_no_trait: 1,
		cortext_tree_order: 1,
		orderby: 'menu_order',
		order: 'asc',
		_fields: TREE_FIELDS.join( ',' ),
	} );
}

export function buildSidebarTreeRecordPath( id ) {
	return addQueryArgs( `${ DOCUMENTS_PATH }/${ normalizeId( id ) }`, {
		context: 'edit',
		_fields: TREE_FIELDS.join( ',' ),
	} );
}

async function fetchBranchPage( parentId, page ) {
	const response = await apiFetch( {
		path: buildSidebarTreeBranchPath( parentId, page ),
		parse: false,
	} );
	const records = await response.json();
	const safeRecords = Array.isArray( records ) ? records : [];
	return {
		records: safeRecords,
		total: headerNumber( response, 'X-WP-Total', safeRecords.length ),
		totalPages: headerNumber(
			response,
			'X-WP-TotalPages',
			safeRecords.length > 0 ? page : 0
		),
	};
}

/**
 * State for the sidebar's lazy-loaded document tree.
 *
 * @param {Object}  args
 * @param {?number} args.selectedId           Currently selected page id, or null.
 * @param {?number} args.selectedCollectionId Currently selected collection id, or null.
 */
export default function useSidebarTree( { selectedId, selectedCollectionId } ) {
	const [ branches, setBranches ] = useState( () => new Map() );
	const [ expandedIds, setExpandedIds ] = useState( () => new Set() );
	const [ isResolvingPreferences, setIsResolvingPreferences ] =
		useState( true );
	const branchesRef = useRef( branches );
	const expandedIdsRef = useRef( expandedIds );
	const loadingRef = useRef( new Map() );
	const preferenceWriteRef = useRef( Promise.resolve() );

	useEffect( () => {
		branchesRef.current = branches;
	}, [ branches ] );

	useEffect( () => {
		expandedIdsRef.current = expandedIds;
	}, [ expandedIds ] );

	const loadedRecords = useMemo( () => {
		const byId = new Map();
		branches.forEach( ( branch ) => {
			branch.records.forEach( ( record ) => {
				byId.set( record.id, record );
			} );
		} );
		return [ ...byId.values() ];
	}, [ branches ] );

	const getBranch = useCallback(
		( parentId ) => branchesRef.current.get( parentKey( parentId ) ),
		[]
	);

	const loadBranch = useCallback( async ( parentId, options = {} ) => {
		const key = parentKey( parentId );
		const current = branchesRef.current.get( key ) ?? EMPTY_BRANCH;
		const append = options.append === true;
		const force = options.force === true;
		const page = append
			? Math.max( 1, current.page + 1 )
			: Math.max( 1, Math.floor( Number( options.page ) || 1 ) );

		if (
			! force &&
			! append &&
			current.hasResolved &&
			current.page >= page
		) {
			return current;
		}
		if ( append && current.hasResolved && ! branchHasMore( current ) ) {
			return current;
		}

		const loadKey = `${ key }:${ page }`;
		if ( loadingRef.current.has( loadKey ) ) {
			return loadingRef.current.get( loadKey );
		}
		setBranches( ( previous ) => {
			const next = new Map( previous );
			next.set( key, {
				...( previous.get( key ) ?? EMPTY_BRANCH ),
				isLoading: true,
				error: null,
			} );
			return next;
		} );

		const promise = fetchBranchPage( key, page )
			.then( ( result ) => {
				let nextBranch;
				setBranches( ( previous ) => {
					const previousBranch = previous.get( key ) ?? EMPTY_BRANCH;
					nextBranch = {
						records: append
							? mergeRecords(
									previousBranch.records,
									result.records
							  )
							: result.records,
						page,
						total: result.total,
						totalPages: result.totalPages,
						isLoading: false,
						hasResolved: true,
						error: null,
					};
					const next = new Map( previous );
					next.set( key, nextBranch );
					branchesRef.current = next;
					return next;
				} );
				return nextBranch;
			} )
			.catch( ( error ) => {
				let nextBranch;
				setBranches( ( previous ) => {
					const previousBranch = previous.get( key ) ?? EMPTY_BRANCH;
					nextBranch = {
						...previousBranch,
						isLoading: false,
						hasResolved: previousBranch.hasResolved,
						error,
					};
					const next = new Map( previous );
					next.set( key, nextBranch );
					branchesRef.current = next;
					return next;
				} );
				return nextBranch;
			} )
			.finally( () => {
				loadingRef.current.delete( loadKey );
			} );
		loadingRef.current.set( loadKey, promise );
		return promise;
	}, [] );

	const loadMore = useCallback(
		( parentId ) => loadBranch( parentId, { append: true } ),
		[ loadBranch ]
	);

	const refreshBranch = useCallback(
		async ( parentId ) => {
			const key = parentKey( parentId );
			const current = branchesRef.current.get( key );
			if ( ! current?.hasResolved ) {
				return loadBranch( key, { force: true } );
			}
			const pagesToLoad = Math.max( 1, current.page );
			let refreshed = null;
			for ( let page = 1; page <= pagesToLoad; page++ ) {
				refreshed = await loadBranch( key, {
					page,
					append: page > 1,
					force: true,
				} );
			}
			return refreshed;
		},
		[ loadBranch ]
	);

	const refreshLoadedBranches = useCallback( () => {
		const parentIds = [ ...branchesRef.current.keys() ];
		return Promise.allSettled(
			parentIds.map( ( parentId ) => refreshBranch( parentId ) )
		);
	}, [ refreshBranch ] );

	const persistExpanded = useCallback( ( ids ) => {
		const expanded = normalizeIds( ids );
		const write = () =>
			apiFetch( {
				path: SIDEBAR_TREE_PREFERENCES_PATH,
				method: 'PUT',
				data: { expanded },
			} );
		const promise = preferenceWriteRef.current.then( write, write );
		preferenceWriteRef.current = promise.catch( () => {} );
		return promise.catch( () => {} );
	}, [] );

	const setExpanded = useCallback(
		( updater, { persist = true } = {} ) => {
			const previous = expandedIdsRef.current;
			const next =
				typeof updater === 'function'
					? updater( previous )
					: new Set( normalizeIds( updater ) );
			expandedIdsRef.current = next;
			setExpandedIds( next );
			if ( persist ) {
				persistExpanded( [ ...next ] );
			}
		},
		[ persistExpanded ]
	);

	const expand = useCallback(
		( id, options = {} ) => {
			const normalized = normalizeId( id );
			if ( normalized < 1 ) {
				return;
			}
			setExpanded( ( previous ) => {
				if ( previous.has( normalized ) ) {
					return previous;
				}
				const next = new Set( previous );
				next.add( normalized );
				return next;
			}, options );
			loadBranch( normalized );
		},
		[ loadBranch, setExpanded ]
	);

	const toggleExpand = useCallback(
		( id ) => {
			const normalized = normalizeId( id );
			if ( normalized < 1 ) {
				return;
			}
			let shouldLoad = false;
			setExpanded( ( previous ) => {
				const next = new Set( previous );
				if ( next.has( normalized ) ) {
					next.delete( normalized );
					const descendants = collectDescendantIds(
						normalized,
						branchesRef.current
					);
					descendants.forEach( ( descendantId ) => {
						next.delete( descendantId );
					} );
				} else {
					next.add( normalized );
					shouldLoad = true;
				}
				return next;
			} );
			if ( shouldLoad ) {
				loadBranch( normalized );
			}
		},
		[ loadBranch, setExpanded ]
	);

	const fetchRecord = useCallback( async ( id ) => {
		const normalized = normalizeId( id );
		if ( normalized < 1 ) {
			return null;
		}
		const loaded = findRecordInBranches( branchesRef.current, normalized );
		if ( loaded ) {
			return loaded;
		}
		try {
			return await apiFetch( {
				path: buildSidebarTreeRecordPath( normalized ),
			} );
		} catch {
			return null;
		}
	}, [] );

	const loadBranchUntilContains = useCallback(
		async ( parentId, childId ) => {
			const key = parentKey( parentId );
			const targetId = normalizeId( childId );
			let branch = branchesRef.current.get( key );
			if (
				branch?.records.some( ( record ) => record.id === targetId )
			) {
				return branch;
			}
			branch = await loadBranch( key );
			while (
				branch?.hasResolved &&
				! branch.records.some( ( record ) => record.id === targetId ) &&
				branchHasMore( branch )
			) {
				branch = await loadBranch( key, { append: true } );
			}
			return branch;
		},
		[ loadBranch ]
	);

	const revealRecordPath = useCallback(
		async ( id, { persist = true } = {} ) => {
			let cursor = await fetchRecord( id );
			if ( ! cursor ) {
				return;
			}
			const chain = [];
			const seen = new Set();
			while ( cursor && ! seen.has( cursor.id ) ) {
				seen.add( cursor.id );
				chain.unshift( cursor );
				const parentId = normalizeId( cursor.parent );
				if ( parentId < 1 ) {
					break;
				}
				cursor = await fetchRecord( parentId );
			}

			let parentId = ROOT_PARENT_ID;
			for ( const record of chain ) {
				await loadBranchUntilContains( parentId, record.id );
				parentId = record.id;
			}

			const ancestorIds = chain
				.slice( 0, -1 )
				.map( ( record ) => record.id );
			if ( ancestorIds.length > 0 ) {
				setExpanded(
					( previous ) => {
						let changed = false;
						const next = new Set( previous );
						ancestorIds.forEach( ( ancestorId ) => {
							if ( ! next.has( ancestorId ) ) {
								next.add( ancestorId );
								changed = true;
							}
						} );
						return changed ? next : previous;
					},
					{ persist }
				);
				ancestorIds.forEach( ( ancestorId ) =>
					loadBranch( ancestorId )
				);
			}
		},
		[ fetchRecord, loadBranch, loadBranchUntilContains, setExpanded ]
	);

	useEffect( () => {
		loadBranch( ROOT_PARENT_ID );
	}, [ loadBranch ] );

	useEffect( () => {
		let cancelled = false;
		setIsResolvingPreferences( true );
		apiFetch( { path: SIDEBAR_TREE_PREFERENCES_PATH } )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				const ids = normalizeIds( response?.expanded );
				const restored = new Set( ids );
				expandedIdsRef.current = restored;
				setExpandedIds( restored );
				ids.forEach( ( id ) => {
					revealRecordPath( id, { persist: false } ).then( () =>
						loadBranch( id )
					);
				} );
			} )
			.catch( () => {} )
			.finally( () => {
				if ( ! cancelled ) {
					setIsResolvingPreferences( false );
				}
			} );
		return () => {
			cancelled = true;
		};
	}, [ loadBranch, revealRecordPath ] );

	useEffect( () => {
		const targetId = selectedId ?? selectedCollectionId ?? null;
		if ( targetId === null ) {
			return;
		}
		revealRecordPath( targetId, { persist: true } );
	}, [ selectedId, selectedCollectionId, revealRecordPath ] );

	useEffect( () => {
		const handleTreeChange = ( event ) => {
			const parentId = event?.detail?.parentId;
			const revealId = normalizeId( event?.detail?.revealId );
			let refreshPromise;
			if ( normalizeId( parentId ) > 0 || parentId === ROOT_PARENT_ID ) {
				refreshPromise = refreshBranch( parentId );
			} else {
				refreshPromise = refreshLoadedBranches();
			}
			if ( revealId > 0 ) {
				Promise.resolve( refreshPromise ).finally( () => {
					revealRecordPath( revealId );
				} );
			}
		};
		window.addEventListener( SIDEBAR_TREE_CHANGED_EVENT, handleTreeChange );
		return () =>
			window.removeEventListener(
				SIDEBAR_TREE_CHANGED_EVENT,
				handleTreeChange
			);
	}, [ refreshBranch, refreshLoadedBranches, revealRecordPath ] );

	const tree = useMemo(
		() => buildNodesForParent( ROOT_PARENT_ID, branches ),
		[ branches ]
	);
	const rootBranch = branches.get( ROOT_PARENT_ID ) ?? EMPTY_BRANCH;

	return {
		tree,
		pages: loadedRecords,
		rootBranch,
		isResolvingPages:
			( rootBranch.isLoading && ! rootBranch.hasResolved ) ||
			isResolvingPreferences,
		expandedIds,
		toggleExpand,
		expand,
		loadBranch,
		loadMore,
		refreshBranch,
		refreshLoadedBranches,
		getBranch,
	};
}
