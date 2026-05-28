import { act, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityRecord: jest.fn().mockReturnValue( { record: null } ),
} ) );

import SidebarFavorites, {
	filterFavoritesForTrashedPage,
	moveFavorite,
	resolveFavoriteItems,
} from '../../../src/components/SidebarFavorites';
import { favoriteKey } from '../../../src/documents';

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
	it( 'renders an inline empty state when there are no favorites', () => {
		renderFavorites();

		expect(
			screen.getByText(
				'Star a page from its title menu to pin it here.'
			)
		).toBeInTheDocument();
	} );

	it( 'builds stable favorite keys from id alone', () => {
		expect( favoriteKey( { id: 12 } ) ).toBe( 'favorite:12' );
		expect( favoriteKey( { id: '9' } ) ).toBe( 'favorite:9' );
	} );

	it( 'moves favorites by sortable id', () => {
		const favorites = [ { id: 1 }, { id: 2 }, { id: 3 } ];

		expect(
			moveFavorite( favorites, 'favorite:3', 'favorite:1' )
		).toEqual( [ { id: 3 }, { id: 1 }, { id: 2 } ] );
	} );

	it( 'returns the same list for no-op or unknown moves', () => {
		const favorites = [ { id: 1 } ];

		expect( moveFavorite( favorites, 'favorite:1', 'favorite:1' ) ).toBe(
			favorites
		);
		expect( moveFavorite( favorites, 'favorite:1', 'favorite:999' ) ).toBe(
			favorites
		);
	} );

	it( 'removes a trashed page and loaded descendants from favorites', () => {
		const favorites = [
			{ id: 1 },
			{ id: 2 },
			{ id: 3 },
			{ id: 4 },
			{ id: 5 },
		];
		const pages = [
			{ id: 1, parent: 0 },
			{ id: 2, parent: 1 },
			{ id: 3, parent: 2 },
			{ id: 4, parent: 0 },
		];

		expect(
			filterFavoritesForTrashedPage( favorites, 1, pages )
		).toEqual( [ { id: 4 }, { id: 5 } ] );
	} );

	it( 'drops row favorites whose collection fell with the trashed page', () => {
		// Trashing page 1 cascades into collection 5 (nested under it).
		// Row 6 lives in that collection, so its favorite must come out of the
		// list too; otherwise the next save would replay a now-trashed row.
		const favorites = [
			{ id: 1 },
			{ id: 6, collection: { id: 5 } },
			{ id: 7, collection: { id: 9 } },
		];
		const pages = [ { id: 1, parent: 0 } ];
		const collections = [
			{ id: 5, parent: 1 },
			{ id: 9, parent: 0 },
		];

		expect(
			filterFavoritesForTrashedPage( favorites, 1, pages, collections )
		).toEqual( [ { id: 7, collection: { id: 9 } } ] );
	} );

	it( 'resolves page and collection favorites from loaded records', () => {
		const items = resolveFavoriteItems(
			[
				{ id: 1, path: 'old-1' },
				{ id: 2, path: 'old-2' },
			],
			[
				{
					id: 1,
					type: 'crtxt_document',
					slug: 'hello',
					title: { rendered: 'Hello', raw: 'Hello' },
					crtxt_trait: [],
				},
			],
			[
				{
					id: 2,
					type: 'crtxt_document',
					slug: 'books',
					title: { rendered: 'Books', raw: 'Books' },
					meta: { cortext_fields: [ 7 ] },
				},
			]
		);

		expect( items ).toMatchObject( [
			{
				id: 1,
				title: 'Hello',
				path: 'hello-1',
				sortableId: 'favorite:1',
			},
			{
				id: 2,
				title: 'Books',
				path: 'books-2',
				sortableId: 'favorite:2',
			},
		] );
	} );

	it( 'uses stored paths when sidebar records are missing', () => {
		const favorites = [
			{
				id: 1,
				title: 'Stored Notes',
				path: 'old-1',
				icon: 'notebook',
			},
		];

		expect( resolveFavoriteItems( favorites, [], [] ) ).toMatchObject( [
			{
				id: 1,
				title: 'Stored Notes',
				path: 'old-1',
				icon: 'notebook',
			},
		] );
	} );

	it( 'uses stored collection titles when sidebar records are missing', () => {
		expect(
			resolveFavoriteItems(
				[
					{
						id: 2,
						title: 'Stored Books',
						path: 'books-2',
					},
				],
				[],
				[]
			)
		).toMatchObject( [
			{
				id: 2,
				title: 'Stored Books',
				path: 'books-2',
			},
		] );
	} );

	it( 'drops missing favorites without a stored path', () => {
		expect( resolveFavoriteItems( [ { id: 1 } ], [], [] ) ).toEqual( [] );
	} );

	it( 'keeps a re-added favorite visible after the removal timer fires', () => {
		jest.useFakeTimers();
		const favorite = { id: 1, path: 'notes-1' };
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

	it( 'does not mark initially loaded favorites as newly added', () => {
		const favorite = { id: 1 };
		const pages = [
			{
				id: 1,
				slug: 'notes',
				title: { rendered: 'Notes', raw: 'Notes' },
			},
		];
		const { rerender } = renderFavorites( {
			favorites: [],
			pages,
			isResolving: true,
		} );

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

		expect(
			screen
				.getByText( 'Notes' )
				.closest( '.cortext-sidebar__favorite-row' )
		).not.toHaveClass( 'is-added' );
	} );

	it( 'marks favorites added after initial load as newly added', () => {
		const notes = { id: 1 };
		const tasks = { id: 2 };
		const pages = [
			{
				id: 1,
				slug: 'notes',
				title: { rendered: 'Notes', raw: 'Notes' },
			},
			{
				id: 2,
				slug: 'tasks',
				title: { rendered: 'Tasks', raw: 'Tasks' },
			},
		];
		const { rerender } = renderFavorites( {
			favorites: [ notes ],
			pages,
		} );

		rerender(
			<SidebarFavorites
				favorites={ [ notes, tasks ] }
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

		expect(
			screen
				.getByText( 'Tasks' )
				.closest( '.cortext-sidebar__favorite-row' )
		).toHaveClass( 'is-added' );
	} );

	it( 'keeps the empty state when favorites is empty and sidebar records re-resolve', () => {
		const { container, rerender } = renderFavorites();

		expect(
			screen.getByText(
				'Star a page from its title menu to pin it here.'
			)
		).toBeInTheDocument();

		rerender(
			<SidebarFavorites
				favorites={ [] }
				pages={ [] }
				collections={ [] }
				isResolving={ false }
				isResolvingItems
				isDisabled={ false }
				onSelect={ jest.fn( () => false ) }
				onRemove={ jest.fn() }
				onReorder={ jest.fn() }
			/>
		);

		expect(
			screen.getByText(
				'Star a page from its title menu to pin it here.'
			)
		).toBeInTheDocument();
		expect(
			container.querySelector( '.cortext-sidebar__loading' )
		).toBeNull();
	} );
} );
