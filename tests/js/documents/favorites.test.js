/**
 * Tests for `src/documents/favorites.js`.
 *
 * The DataView row menu passes row records from `/cortext/v1/rows` into
 * `favoriteIdentForRecord` and `favoriteKeyForRecord`. That endpoint already
 * sets `kind: 'row'`. The `type: 'crtxt_<slug>'` shape from `/wp/v2/{cpt}`
 * still has to resolve too, in case anything reaches the helpers from there.
 */

import {
	favoriteIdentForRecord,
	favoriteKeyForRecord,
} from '../../../src/documents/favorites';

describe( 'favoriteIdentForRecord', () => {
	it( 'resolves a row record from its CPT post type', () => {
		expect(
			favoriteIdentForRecord( { type: 'crtxt_books', id: 7 } )
		).toEqual( { kind: 'row', id: 7 } );
	} );

	it( 'resolves a page record', () => {
		expect(
			favoriteIdentForRecord( { type: 'crtxt_page', id: 12 } )
		).toEqual( { kind: 'page', id: 12 } );
	} );

	it( 'resolves a collection record', () => {
		expect(
			favoriteIdentForRecord( { type: 'crtxt_collection', id: 33 } )
		).toEqual( { kind: 'collection', id: 33 } );
	} );

	it( 'keeps an explicit kind on the record', () => {
		// SidebarFavorites passes the stored favorite shape, which already
		// has `kind`. Do not override it from `type`.
		expect( favoriteIdentForRecord( { kind: 'row', id: 4 } ) ).toEqual( {
			kind: 'row',
			id: 4,
		} );
	} );

	it( 'resolves a row record in the cortext rows endpoint shape', () => {
		// `/cortext/v1/rows` returns `kind` but no `type`. This is what the
		// DataView row menu actually receives, so it has to resolve from
		// `kind` alone.
		expect(
			favoriteIdentForRecord( {
				kind: 'row',
				id: 9,
				title: { raw: 'A row', rendered: 'A row' },
				status: 'publish',
				meta: {},
			} )
		).toEqual( { kind: 'row', id: 9 } );
	} );

	it( 'returns null when a record has no usable kind', () => {
		expect( favoriteIdentForRecord( {} ) ).toBeNull();
		expect( favoriteIdentForRecord( null ) ).toBeNull();
	} );
} );

describe( 'favoriteKeyForRecord', () => {
	it( 'builds a stable key for a row record', () => {
		expect( favoriteKeyForRecord( { type: 'crtxt_books', id: 7 } ) ).toBe(
			'favorite:row:7'
		);
	} );

	it( 'returns null when it cannot resolve the kind', () => {
		expect( favoriteKeyForRecord( {} ) ).toBeNull();
	} );
} );
