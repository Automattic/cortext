import { useState, useMemo, useCallback, useEffect } from '@wordpress/element';

import { buildTree, collectAncestorIds } from '../pages-tree';

/**
 * Sidebar tree state. `documents` is the single non-row list (pages plus
 * collections) that feeds the whole tree, so each document renders once. Page
 * vs collection is a per-record concern derived elsewhere from the
 * `cortext_collection` marker. The hook also expands ancestors of the active
 * selection so direct links from Home, Favorites, or Recents reveal nested
 * documents instead of hiding them under a collapsed parent.
 *
 * @param {Object}  args
 * @param {Array}   args.documents            Loaded non-row `crtxt_document` records (pages and collections).
 * @param {?number} args.selectedId           Currently selected page id, or null.
 * @param {?number} args.selectedCollectionId Currently selected collection id, or null.
 */
export default function useSidebarTree( {
	documents,
	selectedId,
	selectedCollectionId,
} ) {
	const tree = useMemo( () => buildTree( documents ?? [] ), [ documents ] );

	const [ expandedIds, setExpandedIds ] = useState( () => new Set() );

	useEffect( () => {
		const list = documents ?? [];
		let ancestorIds = [];
		if ( selectedId !== null ) {
			ancestorIds = collectAncestorIds( selectedId, list );
		} else if ( selectedCollectionId !== null ) {
			// Direct links from Home, Favorites, and Recents should reveal
			// nested documents instead of leaving them under a collapsed parent.
			const collection = list.find(
				( c ) => c.id === selectedCollectionId
			);
			const parent = Number( collection?.parent ?? 0 );
			if ( parent > 0 ) {
				ancestorIds = [ parent, ...collectAncestorIds( parent, list ) ];
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
	}, [ selectedId, selectedCollectionId, documents ] );

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
