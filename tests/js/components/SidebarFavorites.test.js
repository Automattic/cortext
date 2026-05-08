import { act, render, screen } from '@testing-library/react';

import SidebarFavorites, {
	favoriteKey,
	filterFavoritesForTrashedPage,
	moveFavorite,
	resolveFavoriteItems,
} from '../../../src/components/SidebarFavorites';

function renderFavorites( props = {} ) {
	return render(
		<SidebarFavorites
			favorites={ [] }
			pages={ [] }
			collections={ [] }
			isResolving={ false }
			isResolvingItems={ false }
			isDisabled={ false }
			onSelect={ jest.fn( () => false ) }
			onRemove={ jest.fn() }
			onReorder={ jest.fn() }
			{ ...props }
		/>
	);
}

afterEach( () => {
	jest.useRealTimers();
} );

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

	it( 'removes a trashed page and loaded descendants from favorites', () => {
		const favorites = [
			{ kind: 'page', id: 1 },
			{ kind: 'page', id: 2 },
			{ kind: 'page', id: 3 },
			{ kind: 'page', id: 4 },
			{ kind: 'collection', id: 5 },
		];
		const pages = [
			{ id: 1, parent: 0 },
			{ id: 2, parent: 1 },
			{ id: 3, parent: 2 },
			{ id: 4, parent: 0 },
		];

		expect( filterFavoritesForTrashedPage( favorites, 1, pages ) ).toEqual(
			[
				{ kind: 'page', id: 4 },
				{ kind: 'collection', id: 5 },
			]
		);
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

	it( 'uses stored paths when sidebar records are missing', () => {
		const favorites = [ { kind: 'page', id: 1, path: 'page/old-1' } ];

		expect( resolveFavoriteItems( favorites, [], [] ) ).toMatchObject( [
			{
				kind: 'page',
				id: 1,
				title: 'Page',
				path: 'page/old-1',
			},
		] );
	} );

	it( 'drops missing favorites without a stored path', () => {
		expect(
			resolveFavoriteItems( [ { kind: 'page', id: 1 } ], [], [] )
		).toEqual( [] );
	} );

	it( 'keeps a re-added favorite visible after the removal timer fires', () => {
		jest.useFakeTimers();
		const favorite = { kind: 'page', id: 1, path: 'page/notes-1' };
		const pages = [
			{
				id: 1,
				slug: 'notes',
				title: { rendered: 'Notes', raw: 'Notes' },
			},
		];
		const { rerender } = renderFavorites( {
			favorites: [ favorite ],
			pages,
		} );

		expect( screen.getByText( 'Notes' ) ).toBeInTheDocument();

		rerender(
			<SidebarFavorites
				favorites={ [] }
				pages={ pages }
				collections={ [] }
				isResolving={ false }
				isResolvingItems={ false }
				isDisabled={ false }
				onSelect={ jest.fn( () => false ) }
				onRemove={ jest.fn() }
				onReorder={ jest.fn() }
			/>
		);
		rerender(
			<SidebarFavorites
				favorites={ [ favorite ] }
				pages={ pages }
				collections={ [] }
				isResolving={ false }
				isResolvingItems={ false }
				isDisabled={ false }
				onSelect={ jest.fn( () => false ) }
				onRemove={ jest.fn() }
				onReorder={ jest.fn() }
			/>
		);

		act( () => {
			jest.advanceTimersByTime( 151 );
		} );

		expect( screen.getByText( 'Notes' ) ).toBeInTheDocument();
	} );
} );
