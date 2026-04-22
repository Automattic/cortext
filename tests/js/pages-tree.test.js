/**
 * Pure-function tests for `src/components/pages-tree.js`: flat-to-tree
 * building, descendant collection, cycle detection, drag-drop reorder math,
 * and next-child menu_order allocation.
 */

import {
	buildTree,
	collectDescendants,
	isDescendantOf,
	computeDropTarget,
	nextChildOrder,
} from '../../src/components/pages-tree';

function makePage( id, parent = 0, menuOrder = 0 ) {
	return { id, parent, menu_order: menuOrder };
}

describe( 'buildTree', () => {
	it( 'nests children under their parents', () => {
		const pages = [ makePage( 1 ), makePage( 2, 1 ), makePage( 3, 2 ) ];
		const roots = buildTree( pages );

		expect( roots ).toHaveLength( 1 );
		expect( roots[ 0 ].page.id ).toBe( 1 );
		expect( roots[ 0 ].children ).toHaveLength( 1 );
		expect( roots[ 0 ].children[ 0 ].page.id ).toBe( 2 );
		expect( roots[ 0 ].children[ 0 ].children[ 0 ].page.id ).toBe( 3 );
	} );

	it( 'promotes orphans (missing parent) to roots', () => {
		const pages = [ makePage( 1 ), makePage( 2, 999 ) ];
		const roots = buildTree( pages );

		expect( roots.map( ( r ) => r.page.id ).sort() ).toEqual( [ 1, 2 ] );
	} );

	it( 'sorts siblings by menu_order, then id', () => {
		const pages = [
			makePage( 3, 0, 0 ),
			makePage( 1, 0, 2 ),
			makePage( 2, 0, 0 ),
		];
		const roots = buildTree( pages );

		expect( roots.map( ( r ) => r.page.id ) ).toEqual( [ 2, 3, 1 ] );
	} );
} );

describe( 'collectDescendants', () => {
	it( 'collects descendants of a root but not the root itself', () => {
		const pages = [
			makePage( 1 ),
			makePage( 2, 1 ),
			makePage( 3, 2 ),
			makePage( 4, 1 ),
			makePage( 99 ), // unrelated
		];

		const ids = collectDescendants( 1, pages ).sort();
		expect( ids ).toEqual( [ 2, 3, 4 ] );
	} );

	it( 'returns empty for a leaf', () => {
		const pages = [ makePage( 1 ), makePage( 2, 1 ) ];
		expect( collectDescendants( 2, pages ) ).toEqual( [] );
	} );
} );

describe( 'isDescendantOf', () => {
	const pages = [
		makePage( 1 ),
		makePage( 2, 1 ),
		makePage( 3, 2 ),
		makePage( 4 ),
	];

	it( 'returns true across a multi-level chain', () => {
		expect( isDescendantOf( 3, 1, pages ) ).toBe( true );
	} );

	it( 'returns false for siblings or unrelated pages', () => {
		expect( isDescendantOf( 4, 1, pages ) ).toBe( false );
	} );

	it( 'returns false when the page is missing', () => {
		expect( isDescendantOf( 999, 1, pages ) ).toBe( false );
	} );
} );

describe( 'computeDropTarget', () => {
	it( 'returns null when dragging onto itself', () => {
		const pages = [ makePage( 1 ), makePage( 2 ) ];
		expect( computeDropTarget( 1, 1, 'before', pages ) ).toBeNull();
	} );

	it( 'blocks cycles (ancestor dropped onto descendant)', () => {
		const pages = [ makePage( 1 ), makePage( 2, 1 ), makePage( 3, 2 ) ];
		expect( computeDropTarget( 1, 3, 'inside', pages ) ).toBeNull();
	} );

	it( '"before" on a root reshuffles root-sibling menu_order', () => {
		const pages = [
			makePage( 1, 0, 0 ),
			makePage( 2, 0, 1 ),
			makePage( 3, 0, 2 ),
		];
		const updates = computeDropTarget( 3, 1, 'before', pages );

		expect( updates[ 0 ] ).toEqual( { id: 3, parent: 0, menu_order: 0 } );
		expect( updates.slice( 1 ) ).toEqual(
			expect.arrayContaining( [
				{ id: 1, menu_order: 1 },
				{ id: 2, menu_order: 2 },
			] )
		);
	} );

	it( '"after" on a root places the dragged page right after', () => {
		const pages = [
			makePage( 1, 0, 0 ),
			makePage( 2, 0, 1 ),
			makePage( 3, 0, 2 ),
		];
		const updates = computeDropTarget( 3, 1, 'after', pages );

		expect( updates[ 0 ] ).toEqual( { id: 3, parent: 0, menu_order: 1 } );
		expect( updates.slice( 1 ) ).toEqual(
			expect.arrayContaining( [ { id: 2, menu_order: 2 } ] )
		);
	} );

	it( '"inside" reparents and appends as last child', () => {
		const pages = [
			makePage( 1 ),
			makePage( 2, 1, 0 ),
			makePage( 3, 1, 1 ),
			makePage( 4 ),
		];
		const updates = computeDropTarget( 4, 1, 'inside', pages );

		expect( updates ).toEqual( [ { id: 4, parent: 1, menu_order: 2 } ] );
	} );

	it( 'returns null for a same-parent, same-slot move', () => {
		const pages = [ makePage( 1, 0, 0 ), makePage( 2, 0, 1 ) ];
		expect( computeDropTarget( 1, 2, 'before', pages ) ).toBeNull();
	} );

	it( 'puts the dragged update first and only includes siblings whose menu_order changes', () => {
		const pages = [
			makePage( 1, 0, 0 ),
			makePage( 2, 0, 1 ),
			makePage( 3, 0, 2 ),
		];
		// Drag page 1 to "after" page 2: page 3 stays at menu_order 2, so it
		// should NOT appear in the update list, while page 2 shifts to 0.
		const updates = computeDropTarget( 1, 2, 'after', pages );

		expect( updates[ 0 ].id ).toBe( 1 );
		expect( updates.map( ( u ) => u.id ) ).toEqual(
			expect.arrayContaining( [ 1, 2 ] )
		);
		expect( updates.every( ( u ) => u.id !== 3 ) ).toBe( true );
	} );
} );

describe( 'nextChildOrder', () => {
	it( 'returns 0 for an empty parent', () => {
		expect( nextChildOrder( 1, [ makePage( 1 ) ] ) ).toBe( 0 );
	} );

	it( 'returns max(menu_order) + 1 otherwise', () => {
		const pages = [
			makePage( 1 ),
			makePage( 2, 1, 0 ),
			makePage( 3, 1, 4 ),
			makePage( 4, 1, 2 ),
		];
		expect( nextChildOrder( 1, pages ) ).toBe( 5 );
	} );
} );
