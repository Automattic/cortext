import {
	favoriteKey,
	moveFavorite,
	resolveFavoriteItems,
} from '../../../src/components/SidebarFavorites';

describe( 'SidebarFavorites helpers', () => {
	it( 'builds stable favorite keys', () => {
		expect( favoriteKey( { kind: 'page', id: 12 } ) ).toBe(
			'favorite:page:12'
		);
		expect( favoriteKey( { kind: 'collection', id: '9' } ) ).toBe(
			'favorite:collection:9'
		);
	} );

	it( 'moves favorites by sortable id', () => {
		const favorites = [
			{ kind: 'page', id: 1 },
			{ kind: 'collection', id: 2 },
			{ kind: 'page', id: 3 },
		];

		expect(
			moveFavorite( favorites, 'favorite:page:3', 'favorite:page:1' )
		).toEqual( [
			{ kind: 'page', id: 3 },
			{ kind: 'page', id: 1 },
			{ kind: 'collection', id: 2 },
		] );
	} );

	it( 'returns the same list for no-op or unknown moves', () => {
		const favorites = [ { kind: 'page', id: 1 } ];

		expect(
			moveFavorite( favorites, 'favorite:page:1', 'favorite:page:1' )
		).toBe( favorites );
		expect(
			moveFavorite( favorites, 'favorite:page:1', 'favorite:page:999' )
		).toBe( favorites );
	} );

	it( 'resolves page and collection favorites from loaded records', () => {
		const items = resolveFavoriteItems(
			[
				{ kind: 'page', id: 1, path: 'page/old-1' },
				{ kind: 'collection', id: 2, path: 'collection/old-2' },
			],
			[
				{
					id: 1,
					slug: 'hello',
					title: { rendered: 'Hello', raw: 'Hello' },
				},
			],
			[
				{
					id: 2,
					slug: 'books',
					title: { rendered: 'Books', raw: 'Books' },
				},
			]
		);

		expect( items ).toMatchObject( [
			{
				kind: 'page',
				id: 1,
				title: 'Hello',
				path: 'page/hello-1',
				sortableId: 'favorite:page:1',
			},
			{
				kind: 'collection',
				id: 2,
				title: 'Books',
				path: 'collection/books-2',
				sortableId: 'favorite:collection:2',
			},
		] );
	} );
} );
