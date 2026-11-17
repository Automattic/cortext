import {
	COLLECTION_QUERY,
	FULL_PAGE_COLLECTION_QUERY,
} from '../../src/collections';
import { ACTIVE_PAGES_QUERY } from '../../src/components/page-queries';

function fieldsOf( query ) {
	return query._fields.split( ',' );
}

// These lists refetch after every document save. `content` makes the server
// render every document, and `cortext_has_tree_children` runs a query per
// document, so neither belongs in them.
const EXPENSIVE_FIELDS = [ 'content', 'excerpt', 'cortext_has_tree_children' ];

describe( 'shell document list queries', () => {
	it( 'asks for the fields the pages list consumers read', () => {
		expect( fieldsOf( ACTIVE_PAGES_QUERY ) ).toEqual( [
			'id',
			'parent',
			'menu_order',
			'slug',
			'title',
		] );
	} );

	it( 'asks for the fields the collections list consumers read', () => {
		expect( fieldsOf( COLLECTION_QUERY ) ).toEqual( [
			'id',
			'parent',
			'slug',
			'title',
			'meta',
			'cortext_defines_trait',
			'crtxt_trait',
		] );
	} );

	it.each( [
		[ 'pages', ACTIVE_PAGES_QUERY ],
		[ 'collections', COLLECTION_QUERY ],
	] )( 'keeps expensive and nested fields out of %s', ( _name, query ) => {
		const fields = fieldsOf( query );

		EXPENSIVE_FIELDS.forEach( ( field ) => {
			expect( fields ).not.toContain( field );
		} );
		// core-data merges list records one top-level key at a time, so a
		// nested field would overwrite the rest of that key in the store.
		fields.forEach( ( field ) => {
			expect( field ).not.toContain( '.' );
		} );
	} );

	it( 'shares one collections query object so invalidation matches', () => {
		expect( FULL_PAGE_COLLECTION_QUERY ).toBe( COLLECTION_QUERY );
	} );
} );
