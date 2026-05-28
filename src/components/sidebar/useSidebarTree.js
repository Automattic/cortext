import { useState, useMemo, useCallback, useEffect } from '@wordpress/element';

import { buildTree, collectAncestorIds } from '../pages-tree';

// Pages and collections share one tree. Top-level collections (`parent === 0`)
// always join; nested collections (`parent > 0`) join only if their parent
// page is in the loaded set, since orphans without an anchor would render
// detached from any node. See tech-debt.md#td-workspace-tree-no-unified-model
// for the paged tree endpoint that would lift this gating.
function deriveTreeCollections( pages, collections ) {
	const pageIds = new Set( pages.map( ( p ) => p.id ) );
	return ( collections ?? [] ).filter( ( collection ) => {
		const parent = collection.parent ?? 0;
		return parent === 0 || pageIds.has( parent );
	} );
}

/**
 * Sidebar tree state: pages and nested collections merged into one tree,
 * the expanded-id set, and helpers for toggling branches. It also expands
 * ancestors of the active selection so direct links from Home, Favorites, or
 * Recents reveal nested collections instead of hiding them under a collapsed
 * page.
 *
 * @param {Object}  args
 * @param {Array}   args.pages                Loaded `crtxt_document` records.
 * @param {Array}   args.collections          Loaded `crtxt_document` collection records (may be undefined while resolving).
 * @param {?number} args.selectedId           Currently selected page id, or null.
 * @param {?number} args.selectedCollectionId Currently selected collection id, or null.
 */
export default function useSidebarTree( {
	pages,
	collections,
	selectedId,
	selectedCollectionId,
} ) {
	const treeCollections = useMemo(
		() => deriveTreeCollections( pages, collections ),
		[ pages, collections ]
	);

	const tree = useMemo(
		() => buildTree( [ ...pages, ...treeCollections ] ),
		[ pages, treeCollections ]
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
		tree,
		expandedIds,
		toggleExpand,
		expand,
	};
}
