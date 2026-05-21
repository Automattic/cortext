import { useState, useMemo, useCallback, useEffect } from '@wordpress/element';

import { buildTree, collectAncestorIds } from '../pages-tree';

// Pages and full-page collections share one tree. Collections with a loaded
// page parent appear under that page. Collections without a loaded page
// parent stay in the Collections section, including row-owned collections
// for now (tech-debt.md#53).
//
// Sort top-level collections here. Otherwise `useEntityRecords` returns
// whatever order core-data emits, which can shift after a rename and reorder
// the sidebar. Nested collections get the same menu_order/id sort through
// `buildTree`.
function deriveCollectionGroups( pages, collections ) {
	const pageIds = new Set( pages.map( ( p ) => p.id ) );
	const nested = [];
	const topLevel = [];
	( collections ?? [] ).forEach( ( collection ) => {
		const parent = collection.parent ?? 0;
		if ( parent && pageIds.has( parent ) ) {
			nested.push( collection );
		} else {
			topLevel.push( collection );
		}
	} );
	topLevel.sort( ( a, b ) => {
		const ao = a.menu_order || 0;
		const bo = b.menu_order || 0;
		if ( ao !== bo ) {
			return ao - bo;
		}
		return a.id - b.id;
	} );
	return { nestedCollections: nested, topLevelCollections: topLevel };
}

/**
 * Sidebar tree state: pages and nested collections merged into one tree,
 * the expanded-id set, and helpers for toggling branches. It also expands
 * ancestors of the active selection so direct links from Home, Favorites, or
 * Recents reveal nested collections instead of hiding them under a collapsed
 * page.
 *
 * @param {Object}  args
 * @param {Array}   args.pages                Loaded `crtxt_page` records.
 * @param {Array}   args.collections          Loaded `crtxt_collection` records (may be undefined while resolving).
 * @param {?number} args.selectedId           Currently selected page id, or null.
 * @param {?number} args.selectedCollectionId Currently selected collection id, or null.
 */
export default function useSidebarTree( {
	pages,
	collections,
	selectedId,
	selectedCollectionId,
} ) {
	const { nestedCollections, topLevelCollections } = useMemo(
		() => deriveCollectionGroups( pages, collections ),
		[ pages, collections ]
	);

	const tree = useMemo(
		() => buildTree( [ ...pages, ...nestedCollections ] ),
		[ pages, nestedCollections ]
	);

	const [ expandedIds, setExpandedIds ] = useState( () => new Set() );

	useEffect( () => {
		let ancestorIds = [];
		if ( selectedId !== null ) {
			ancestorIds = collectAncestorIds( selectedId, pages );
		} else if ( selectedCollectionId !== null ) {
			// Direct links from Home, Favorites, and Recents should reveal
			// nested collections instead of leaving them under a collapsed page.
			const collection = ( collections ?? [] ).find(
				( c ) => c.id === selectedCollectionId
			);
			const parent = Number( collection?.parent ?? 0 );
			if ( parent > 0 ) {
				ancestorIds = [
					parent,
					...collectAncestorIds( parent, pages ),
				];
			}
		}
		if ( ancestorIds.length === 0 ) {
			return;
		}
		setExpandedIds( ( prev ) => {
			let changed = false;
			const next = new Set( prev );
			ancestorIds.forEach( ( id ) => {
				if ( ! next.has( id ) ) {
					next.add( id );
					changed = true;
				}
			} );
			return changed ? next : prev;
		} );
	}, [ selectedId, selectedCollectionId, pages, collections ] );

	const toggleExpand = useCallback( ( id ) => {
		setExpandedIds( ( prev ) => {
			const next = new Set( prev );
			if ( next.has( id ) ) {
				next.delete( id );
			} else {
				next.add( id );
			}
			return next;
		} );
	}, [] );

	const expand = useCallback( ( id ) => {
		setExpandedIds( ( prev ) => {
			if ( prev.has( id ) ) {
				return prev;
			}
			const next = new Set( prev );
			next.add( id );
			return next;
		} );
	}, [] );

	return {
		nestedCollections,
		topLevelCollections,
		tree,
		expandedIds,
		toggleExpand,
		expand,
	};
}
