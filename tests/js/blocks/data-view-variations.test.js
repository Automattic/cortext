/**
 * Tests for the `cortext/data-view` block variations.
 *
 * The inserter should offer two single-purpose entries: "Collection" (create a
 * new collection inline, the default that replaces the bare block) and "Linked
 * collection view" (point at an existing collection). They are told apart by a
 * transient `intent` attribute the block clears on mount.
 */
import { DATA_VIEW_VARIATIONS } from '../../../src/blocks/data-view/variations';

const byName = ( name ) =>
	DATA_VIEW_VARIATIONS.find( ( variation ) => variation.name === name );

it( 'exposes exactly the create and link variations', () => {
	expect(
		DATA_VIEW_VARIATIONS.map( ( variation ) => variation.name )
	).toEqual( [ 'cortext-collection-new', 'cortext-collection-linked' ] );
} );

it( 'makes the create variation the inserter default', () => {
	const create = byName( 'cortext-collection-new' );
	expect( create.isDefault ).toBe( true );
	expect( create.attributes.intent ).toBe( 'create-inline' );
	expect( create.scope ).toEqual( [ 'inserter' ] );
} );

it( 'keeps the linked variation a non-default inserter entry', () => {
	const linked = byName( 'cortext-collection-linked' );
	expect( linked.isDefault ).toBeFalsy();
	expect( linked.attributes.intent ).toBe( 'link-existing' );
	expect( linked.scope ).toEqual( [ 'inserter' ] );
} );

it( 'gives both variations search keywords so they surface in the inserter', () => {
	DATA_VIEW_VARIATIONS.forEach( ( variation ) => {
		expect( variation.keywords ).toEqual(
			expect.arrayContaining( [ 'collection', 'database' ] )
		);
	} );
} );

it( 'matches a block to its variation by intent', () => {
	const create = byName( 'cortext-collection-new' );
	expect(
		create.isActive( { intent: 'create-inline' }, create.attributes )
	).toBe( true );
	expect(
		create.isActive( { intent: 'link-existing' }, create.attributes )
	).toBe( false );
	// A bound block whose transient intent was cleared matches no variation.
	expect( create.isActive( {}, create.attributes ) ).toBe( false );
} );
