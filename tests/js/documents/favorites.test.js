/**
 * Tests for `src/documents/favorites.js`.
 *
 * Favorites now carry only an `id` — kind tags moved out of the wire format
 * and the storage. `favoriteIdentForRecord` and `favoriteKeyForRecord`
 * accept any document-shaped record and just need a numeric id.
 */

import {
	favoriteIdentForRecord,
	favoriteKey,
	favoriteKeyForRecord,
} from '../../../src/documents/favorites';

describe( 'favoriteIdentForRecord', () => {
	it( 'builds an ident from a document record', () => {
		expect(
			favoriteIdentForRecord( {
				type: 'crtxt_document',
				id: 7,
			} )
		).toEqual( { id: 7 } );
	} );

	it( 'coerces a string id to a number', () => {
		expect( favoriteIdentForRecord( { id: '12' } ) ).toEqual( { id: 12 } );
	} );

	it( 'returns null when the record has no usable id', () => {
		expect( favoriteIdentForRecord( {} ) ).toBeNull();
		expect( favoriteIdentForRecord( null ) ).toBeNull();
	} );
} );

describe( 'favoriteKey', () => {
	it( 'builds a stable key from an id only', () => {
		expect( favoriteKey( { id: 12 } ) ).toBe( 'favorite:12' );
		expect( favoriteKey( { id: '9' } ) ).toBe( 'favorite:9' );
	} );
} );

describe( 'favoriteKeyForRecord', () => {
	it( 'builds a key from a record id', () => {
		expect(
			favoriteKeyForRecord( {
				type: 'crtxt_document',
				id: 7,
			} )
		).toBe( 'favorite:7' );
	} );

	it( 'returns null when the record has no id', () => {
		expect( favoriteKeyForRecord( {} ) ).toBeNull();
	} );
} );
