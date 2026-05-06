/**
 * Pure helpers for turning the flat list of pages returned by the REST API
 * into a nested tree, and for computing the minimal set of parent/menu_order
 * updates needed when a page is dragged to a new spot.
 */

/**
 * Build a tree from a flat array of page records.
 *
 * @param {Array} pages Flat array of page records (with id, parent, menu_order).
 * @return {Array} Root nodes: { page, children }. Orphans (whose parent is
 *                 not in the set) are promoted to roots. Siblings are sorted
 *                 by menu_order, then id.
 */
export function buildTree( pages ) {
	const map = new Map();
	pages.forEach( ( page ) => {
		map.set( page.id, { page, children: [] } );
	} );

	const roots = [];
	pages.forEach( ( page ) => {
		const node = map.get( page.id );
		if ( page.parent && map.has( page.parent ) ) {
			map.get( page.parent ).children.push( node );
		} else {
			roots.push( node );
		}
	} );

	const sortSiblings = ( nodes ) => {
		nodes.sort( ( a, b ) => {
			const ao = a.page.menu_order || 0;
			const bo = b.page.menu_order || 0;
			if ( ao !== bo ) {
				return ao - bo;
			}
			return a.page.id - b.page.id;
		} );
		nodes.forEach( ( n ) => sortSiblings( n.children ) );
	};
	sortSiblings( roots );

	return roots;
}

/**
 * Returns the first page in the same ordering used by the sidebar tree.
 *
 * @param {Array} pages Flat page list.
 * @return {Object|null} First root page, or null when there are no pages.
 */
export function firstPageInTree( pages ) {
	return buildTree( pages )[ 0 ]?.page ?? null;
}

/**
 * Collect all descendant page IDs of a root page (root not included).
 * Used by the cascading delete path.
 *
 * @param {number} rootId Root page ID.
 * @param {Array}  pages  Flat page list.
 * @return {number[]} Descendant IDs in no guaranteed order.
 */
export function collectDescendants( rootId, pages ) {
	const childrenByParent = new Map();
	pages.forEach( ( p ) => {
		const arr = childrenByParent.get( p.parent ) || [];
		arr.push( p.id );
		childrenByParent.set( p.parent, arr );
	} );

	const out = [];
	const stack = [ ...( childrenByParent.get( rootId ) || [] ) ];
	while ( stack.length ) {
		const id = stack.pop();
		out.push( id );
		const kids = childrenByParent.get( id );
		if ( kids ) {
			stack.push( ...kids );
		}
	}
	return out;
}

/**
 * Collect ancestor page IDs for a page, nearest parent first.
 * Used to expand the sidebar path for the active page after a reload.
 *
 * @param {number} pageId Active page ID.
 * @param {Array}  pages  Flat page list.
 * @return {number[]} Ancestor IDs, nearest parent first.
 */
export function collectAncestorIds( pageId, pages ) {
	const byId = new Map( pages.map( ( p ) => [ p.id, p ] ) );
	const out = [];
	const seen = new Set( [ pageId ] );
	let current = byId.get( pageId );

	while ( current?.parent && byId.has( current.parent ) ) {
		if ( seen.has( current.parent ) ) {
			break;
		}
		out.push( current.parent );
		seen.add( current.parent );
		current = byId.get( current.parent );
	}

	return out;
}

/**
 * True iff `descendantId` is anywhere in the ancestor chain of `ancestorId`.
 * Used to reject drops that would create a cycle.
 *
 * @param {number} descendantId Candidate descendant.
 * @param {number} ancestorId   Candidate ancestor.
 * @param {Array}  pages        Flat page list.
 * @return {boolean} True if descendantId is a descendant of ancestorId.
 */
export function isDescendantOf( descendantId, ancestorId, pages ) {
	const byId = new Map( pages.map( ( p ) => [ p.id, p ] ) );
	let current = byId.get( descendantId );
	while ( current && current.parent ) {
		if ( current.parent === ancestorId ) {
			return true;
		}
		current = byId.get( current.parent );
	}
	return false;
}

/**
 * Given a drag source, a hover target, and a drop zone, return the minimal
 * set of record updates needed to persist the move. Returns `null` if the
 * drop would be a no-op or would create a cycle.
 *
 * @param {number}                    draggedId ID of the page being dragged.
 * @param {number}                    overId    ID of the page the cursor is hovering over.
 * @param {'before'|'after'|'inside'} zone
 * @param {Array}                     pages     Flat page list.
 * @return {null | Array<{id: number, parent?: number, menu_order?: number}>}
 *         First entry is always the dragged page's update; remaining entries
 *         are sibling reshuffles whose menu_order actually needs to change.
 */
export function computeDropTarget( draggedId, overId, zone, pages ) {
	if ( draggedId === overId ) {
		return null;
	}
	if ( isDescendantOf( overId, draggedId, pages ) ) {
		return null;
	}

	const over = pages.find( ( p ) => p.id === overId );
	if ( ! over ) {
		return null;
	}

	const dragged = pages.find( ( p ) => p.id === draggedId );
	if ( ! dragged ) {
		return null;
	}

	let newParent;
	let insertIndex;

	if ( zone === 'inside' ) {
		newParent = overId;
		const children = pages
			.filter( ( p ) => p.parent === newParent && p.id !== draggedId )
			.sort( ( a, b ) => ( a.menu_order || 0 ) - ( b.menu_order || 0 ) );
		insertIndex = children.length; // append as last child
	} else {
		newParent = over.parent || 0;
		const siblings = pages
			.filter(
				( p ) => ( p.parent || 0 ) === newParent && p.id !== draggedId
			)
			.sort( ( a, b ) => ( a.menu_order || 0 ) - ( b.menu_order || 0 ) );
		const overIdx = siblings.findIndex( ( s ) => s.id === overId );
		insertIndex = zone === 'before' ? overIdx : overIdx + 1;
	}

	const destinationSiblings = pages
		.filter(
			( p ) => ( p.parent || 0 ) === newParent && p.id !== draggedId
		)
		.sort( ( a, b ) => ( a.menu_order || 0 ) - ( b.menu_order || 0 ) );

	const updates = [
		{ id: draggedId, parent: newParent, menu_order: insertIndex },
	];

	destinationSiblings.forEach( ( sibling, i ) => {
		const nextOrder = i >= insertIndex ? i + 1 : i;
		if ( ( sibling.menu_order || 0 ) !== nextOrder ) {
			updates.push( { id: sibling.id, menu_order: nextOrder } );
		}
	} );

	// No-op guard: same parent + same slot.
	if (
		( dragged.parent || 0 ) === newParent &&
		( dragged.menu_order || 0 ) === insertIndex &&
		updates.length === 1
	) {
		return null;
	}

	return updates;
}

/**
 * Compute the menu_order for a new child appended under `parentId`.
 * Used by the "Add child page" action.
 *
 * @param {number} parentId Parent page ID.
 * @param {Array}  pages    Flat page list.
 * @return {number} menu_order value to use for the new child.
 */
export function nextChildOrder( parentId, pages ) {
	const children = pages.filter( ( p ) => ( p.parent || 0 ) === parentId );
	if ( children.length === 0 ) {
		return 0;
	}
	return (
		children.reduce( ( m, c ) => Math.max( m, c.menu_order || 0 ), 0 ) + 1
	);
}
