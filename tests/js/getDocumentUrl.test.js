import getDocumentUrl from '../../src/router/getDocumentUrl';

it( 'returns the server-provided path when present', () => {
	expect(
		getDocumentUrl( {
			kind: 'page',
			id: 12,
			path: 'page/about-us-12',
		} )
	).toBe( 'page/about-us-12' );
} );

it( 'falls back to the collection path for rows without an explicit path', () => {
	expect(
		getDocumentUrl( {
			kind: 'row',
			id: 5,
			collection: { id: 9, path: 'collection/projects-9' },
		} )
	).toBe( 'collection/projects-9' );
} );

it( 'composes a bare id path for pages without a slug', () => {
	expect( getDocumentUrl( { kind: 'page', id: 42 } ) ).toBe( 'page/42' );
} );

it( 'returns empty string for unrecognised documents', () => {
	expect( getDocumentUrl( null ) ).toBe( '' );
	expect( getDocumentUrl( {} ) ).toBe( '' );
	expect( getDocumentUrl( { kind: 'row' } ) ).toBe( '' );
} );
