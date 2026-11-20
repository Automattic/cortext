import {
	activeRowSourceCollectionId,
	rowSourceCollectionHint,
	rowSourceCollectionSearch,
} from '../../../src/router/rowSourceCollection';

describe( 'row source collection routing', () => {
	it( 'prefers a requested active membership', () => {
		expect( activeRowSourceCollectionId( [ 7, 8 ], '8' ) ).toBe( 8 );
	} );

	it( 'falls back when the requested membership is stale or inactive', () => {
		expect( activeRowSourceCollectionId( [ 7, 8 ], 9 ) ).toBe( 7 );
		expect( activeRowSourceCollectionId( [], 9 ) ).toBeNull();
	} );

	it( 'ignores a source hint inherited from another row navigation', () => {
		expect(
			rowSourceCollectionHint( { collection: 8, collectionRow: 42 }, 43 )
		).toBeNull();
		expect(
			rowSourceCollectionHint(
				{ collection: 8, collectionRow: '42' },
				42
			)
		).toBe( 8 );
	} );

	it( 'sets and clears only the source collection search parameter', () => {
		expect(
			rowSourceCollectionSearch( 42, 8 )( { filter: 'open' } )
		).toEqual( {
			filter: 'open',
			collection: 8,
			collectionRow: 42,
		} );
		expect(
			rowSourceCollectionSearch(
				42,
				null
			)( {
				filter: 'open',
				collection: 8,
				collectionRow: 42,
			} )
		).toEqual( { filter: 'open' } );
	} );
} );
