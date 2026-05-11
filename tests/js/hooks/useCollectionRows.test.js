import { renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useCollectionRows from '../../../src/hooks/useCollectionRows';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( {
		rows: [],
		collection: null,
		total: 0,
		totalPages: 1,
	} );
} );

function lastRequestPath() {
	return decodeURIComponent( apiFetch.mock.calls.at( -1 )[ 0 ].path );
}

const baseFields = [
	{ id: 'title', cortextType: 'title' },
	{ id: 'created_by', cortextType: 'text' },
	{ id: 'field-10', recordId: 10, cortextType: 'text' },
	{ id: 'field-20', recordId: 20, cortextType: 'rollup' },
];

describe( 'useCollectionRows', () => {
	it( 'requests the current server page by default', async () => {
		const view = {
			type: 'table',
			filters: [],
			page: 2,
			perPage: 50,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'server' );
		expect( lastRequestPath() ).toContain( 'collection=7' );
		expect( lastRequestPath() ).toContain( 'page=2' );
		expect( lastRequestPath() ).toContain( 'per_page=50' );
	} );

	it( 'refetches when the current server page changes', async () => {
		const { rerender } = renderHook(
			( { view } ) => useCollectionRows( 7, view, baseFields ),
			{
				initialProps: {
					view: {
						type: 'table',
						filters: [],
						page: 1,
						perPage: 25,
					},
				},
			}
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		rerender( {
			view: {
				type: 'table',
				filters: [],
				page: 3,
				perPage: 100,
			},
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( lastRequestPath() ).toContain( 'page=3' );
		expect( lastRequestPath() ).toContain( 'per_page=100' );
	} );

	it( 'falls back to paged client mode for global search', async () => {
		const view = {
			type: 'table',
			filters: [],
			page: 2,
			perPage: 50,
			search: 'ada',
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'client' );
		expect( lastRequestPath() ).toContain( 'collection=7' );
		expect( lastRequestPath() ).toContain( 'page=1' );
		expect( lastRequestPath() ).toContain( 'per_page=100' );
		expect( lastRequestPath() ).not.toContain( 'search=ada' );
	} );

	it( 'accumulates every server page in client mode', async () => {
		apiFetch.mockImplementation( ( { path } ) => {
			const page = Number(
				new URL( path, 'https://example.test' ).searchParams.get(
					'page'
				)
			);
			return Promise.resolve( {
				rows: [ { id: page } ],
				collection: null,
				total: 3,
				totalPages: 3,
			} );
		} );

		const view = {
			type: 'table',
			filters: [],
			page: 1,
			perPage: 25,
			search: 'ada',
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( result.current.data ).toHaveLength( 3 ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 3 );
		expect( result.current.data.map( ( row ) => row.id ) ).toEqual( [
			1, 2, 3,
		] );
		expect( result.current.queryMode ).toBe( 'client' );
	} );

	it( 'fetches remaining client-mode pages in parallel', async () => {
		const resolvers = new Map();
		apiFetch.mockImplementation( ( { path } ) => {
			const page = Number(
				new URL( path, 'https://example.test' ).searchParams.get(
					'page'
				)
			);
			if ( page === 1 ) {
				return Promise.resolve( {
					rows: [ { id: 1 } ],
					collection: null,
					total: 4,
					totalPages: 4,
				} );
			}
			return new Promise( ( resolve ) => {
				resolvers.set( page, () =>
					resolve( {
						rows: [ { id: page } ],
						collection: null,
						total: 4,
						totalPages: 4,
					} )
				);
			} );
		} );

		const view = {
			type: 'table',
			filters: [],
			page: 1,
			perPage: 25,
			search: 'ada',
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 4 ) );

		resolvers.get( 4 )();
		resolvers.get( 2 )();
		resolvers.get( 3 )();

		await waitFor( () =>
			expect( result.current.data.map( ( row ) => row.id ) ).toEqual( [
				1, 2, 3, 4,
			] )
		);
	} );

	it( 'falls back to paged client mode for unsupported filters and sorts', async () => {
		const view = {
			type: 'table',
			filters: [
				{
					field: 'field-10',
					operator: 'contains',
					value: 'red',
				},
			],
			sort: {
				field: 'field-20',
				direction: 'asc',
			},
			page: 2,
			perPage: 50,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'client' );
		expect( lastRequestPath() ).toContain( 'page=1' );
		expect( lastRequestPath() ).toContain( 'per_page=100' );
		expect( lastRequestPath() ).not.toContain( 'filters[0][field]' );
		expect( lastRequestPath() ).not.toContain( 'sort[field]' );
	} );

	it( 'falls back for text-like system fields the server rejects', async () => {
		const view = {
			type: 'table',
			filters: [
				{
					field: 'created_by',
					operator: 'is',
					value: 'Ada',
				},
			],
			sort: {
				field: 'created_by',
				direction: 'asc',
			},
			page: 1,
			perPage: 25,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'client' );
		expect( lastRequestPath() ).toContain( 'page=1' );
		expect( lastRequestPath() ).toContain( 'per_page=100' );
		expect( lastRequestPath() ).not.toContain( 'created_by' );
	} );

	it( 'falls back for incomplete multi-value filters', async () => {
		const view = {
			type: 'table',
			filters: [
				{
					field: 'field-10',
					operator: 'isAny',
					value: [],
				},
			],
			page: 1,
			perPage: 25,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'client' );
		expect( lastRequestPath() ).toContain( 'page=1' );
		expect( lastRequestPath() ).toContain( 'per_page=100' );
		expect( lastRequestPath() ).not.toContain( 'filters[0][field]' );
	} );

	it( 'falls back to paged client mode when calculations are active', async () => {
		const view = {
			type: 'table',
			filters: [],
			calculations: {
				'field-10': 'count',
			},
			page: 1,
			perPage: 25,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'client' );
		expect( lastRequestPath() ).toContain( 'page=1' );
		expect( lastRequestPath() ).toContain( 'per_page=100' );
	} );

	it( 'forwards supported filters and sort in server mode', async () => {
		const view = {
			type: 'table',
			filters: [
				{
					field: 'field-10',
					operator: 'is',
					value: 'red',
				},
			],
			sort: {
				field: 'title',
				direction: 'asc',
			},
			page: 1,
			perPage: 25,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'server' );
		expect( lastRequestPath() ).toContain( 'sort[field]=title' );
		expect( lastRequestPath() ).toContain( 'sort[direction]=asc' );
		expect( lastRequestPath() ).toContain(
			'filters[0][field]=field-10'
		);
		expect( lastRequestPath() ).toContain( 'filters[0][operator]=is' );
		expect( lastRequestPath() ).toContain( 'filters[0][value]=red' );
	} );

	it( 'supports forced paged client mode for relation pickers', async () => {
		const view = {
			type: 'table',
			filters: [],
			page: 1,
			perPage: 25,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields, { forceClient: true } )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'client' );
		expect( lastRequestPath() ).toContain( 'collection=7' );
		expect( lastRequestPath() ).toContain( 'page=1' );
		expect( lastRequestPath() ).toContain( 'per_page=100' );
	} );

	it( 'refetches rows when the visible schema gains a rollup field', async () => {
		const view = { type: 'table', filters: [] };
		const initialFields = [
			{ id: 'title', cortextType: 'title' },
			{ id: 'field-10', recordId: 10, cortextType: 'relation' },
		];
		const nextFields = [
			...initialFields,
			{ id: 'field-20', recordId: 20, cortextType: 'rollup' },
		];

		const { rerender } = renderHook(
			( { fields } ) => useCollectionRows( 7, view, fields ),
			{ initialProps: { fields: initialFields } }
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		rerender( { fields: nextFields } );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( apiFetch ).toHaveBeenLastCalledWith(
			expect.objectContaining( {
				path: expect.stringContaining( 'collection=7' ),
			} )
		);
	} );
} );
