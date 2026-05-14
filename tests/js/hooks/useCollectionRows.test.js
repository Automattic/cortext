import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useCollectionRows, {
	buildQueryArgs,
	buildQueryPlan,
} from '../../../src/hooks/useCollectionRows';
import { notifyCollectionRowsChanged } from '../../../src/hooks/rowInvalidation';

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

const textOperators = [
	'is',
	'isNot',
	'contains',
	'notContains',
	'startsWith',
	'endsWith',
	'isEmpty',
	'isNotEmpty',
];
const numberOperators = [
	'is',
	'greaterThan',
	'lessThan',
	'between',
	'isEmpty',
];
const selectOperators = [ 'is', 'isNot', 'isAny', 'isNone' ];
const checkboxOperators = [ 'isChecked', 'isUnchecked' ];

const baseFields = [
	{
		id: 'title',
		cortextType: 'title',
		sortable: true,
		filterable: true,
		operators: textOperators,
	},
	{
		id: 'created_at',
		cortextType: 'datetime',
		sortable: true,
		filterable: false,
		operators: [],
	},
	{
		id: 'created_by',
		cortextType: 'text',
		sortable: false,
		filterable: false,
		operators: [],
	},
	{
		id: 'field-10',
		recordId: 10,
		cortextType: 'text',
		sortable: true,
		filterable: true,
		operators: textOperators,
	},
	{
		id: 'field-20',
		recordId: 20,
		cortextType: 'number',
		sortable: true,
		filterable: true,
		operators: numberOperators,
	},
	{
		id: 'field-30',
		recordId: 30,
		cortextType: 'relation',
		sortable: false,
		filterable: false,
		operators: [],
	},
	{
		id: 'field-40',
		recordId: 40,
		cortextType: 'rollup',
		sortable: false,
		filterable: false,
		operators: [],
	},
	{
		id: 'field-50',
		recordId: 50,
		cortextType: 'checkbox',
		sortable: true,
		filterable: true,
		operators: checkboxOperators,
	},
	{
		id: 'field-60',
		recordId: 60,
		cortextType: 'select',
		sortable: true,
		filterable: true,
		operators: selectOperators,
	},
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

	it( 'forwards search and supported sort in server mode', async () => {
		const view = {
			type: 'table',
			search: 'alpha beta',
			filters: [],
			sort: {
				field: 'field-20',
				direction: 'desc',
			},
			page: 1,
			perPage: 25,
		};

		const { result } = renderHook( () =>
			useCollectionRows( 7, view, baseFields )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'server' );
		expect( lastRequestPath() ).toContain( 'search=alpha beta' );
		expect( lastRequestPath() ).toContain( 'sort[field]=field-20' );
		expect( lastRequestPath() ).toContain( 'sort[direction]=desc' );
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
			calculations: {
				'field-10': 'count',
			},
			page: 1,
			perPage: 25,
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
			calculations: {
				'field-10': 'count',
			},
			page: 1,
			perPage: 25,
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
					field: 'field-30',
					operator: 'contains',
					value: 'unsupported relation',
				},
			],
			sort: {
				field: 'field-40',
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

	it( 'omits incomplete known filters instead of falling back to client mode', async () => {
		const view = {
			type: 'table',
			filters: [
				{
					field: 'field-60',
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
		expect( result.current.queryMode ).toBe( 'server' );
		expect( lastRequestPath() ).toContain( 'page=1' );
		expect( lastRequestPath() ).toContain( 'per_page=25' );
		expect( lastRequestPath() ).not.toContain( 'filters[0][field]' );
	} );

	it( 'forwards supported leaf and grouped filters in server mode', async () => {
		const view = {
			type: 'table',
			filters: [
				{ field: 'title', operator: 'startsWith', value: 'A' },
				{
					relation: 'OR',
					filters: [
						{
							field: 'field-10',
							operator: 'contains',
							value: 'urgent',
						},
						{
							field: 'field-20',
							operator: 'greaterThan',
							value: 10,
						},
					],
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
		expect( lastRequestPath() ).toContain( 'filters[0][field]=title' );
		expect( lastRequestPath() ).toContain( 'filters[1][relation]=OR' );
		expect( lastRequestPath() ).toContain(
			'filters[1][filters][0][field]=field-10'
		);
		expect( lastRequestPath() ).toContain(
			'filters[1][filters][1][field]=field-20'
		);
	} );

	it( 'falls back when an AND group has an unsupported descendant', async () => {
		const view = {
			type: 'table',
			filters: [
				{
					relation: 'AND',
					filters: [
						{
							field: 'field-10',
							operator: 'contains',
							value: 'urgent',
						},
						{
							field: 'field-30',
							operator: 'contains',
							value: 'unsupported relation',
						},
					],
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
		expect( lastRequestPath() ).not.toContain( 'filters[0][field]' );
	} );

	it( 'serializes array filter values', () => {
		const args = buildQueryArgs(
			7,
			{
				filters: [
					{
						field: 'field-10',
						operator: 'isAny',
						value: [ 'alpha', 'beta' ],
					},
				],
			},
			[
				{
					id: 'title',
					cortextType: 'title',
					sortable: true,
					filterable: true,
					operators: textOperators,
				},
				{
					id: 'field-10',
					cortextType: 'select',
					sortable: true,
					filterable: true,
					operators: selectOperators,
				},
			]
		);

		expect( args[ 'filters[0][value][0]' ] ).toBe( 'alpha' );
		expect( args[ 'filters[0][value][1]' ] ).toBe( 'beta' );
	} );

	it( 'normalizes DataViews option filter value shapes for server queries', () => {
		const multiValueArgs = buildQueryArgs(
			7,
			{
				filters: [
					{
						field: 'field-60',
						operator: 'isAny',
						value: 'Finished',
					},
				],
			},
			baseFields
		);
		const singleValueArgs = buildQueryArgs(
			7,
			{
				filters: [
					{
						field: 'field-60',
						operator: 'is',
						value: [ 'Finished' ],
					},
				],
			},
			baseFields
		);

		expect( multiValueArgs[ 'filters[0][operator]' ] ).toBe( 'isAny' );
		expect( multiValueArgs[ 'filters[0][value][0]' ] ).toBe( 'Finished' );
		expect( singleValueArgs[ 'filters[0][operator]' ] ).toBe( 'is' );
		expect( singleValueArgs[ 'filters[0][value]' ] ).toBe( 'Finished' );
		expect(
			buildQueryPlan(
				7,
				{
					filters: [
						{
							field: 'field-60',
							operator: 'isAny',
							value: 'Finished',
						},
					],
				},
				baseFields
			).mode
		).toBe( 'server' );
	} );

	it( 'treats incomplete grouped filters as no-op filters with relation semantics', () => {
		const andArgs = buildQueryArgs(
			7,
			{
				filters: [
					{
						relation: 'AND',
						filters: [
							{
								field: 'field-60',
								operator: 'isAny',
								value: [],
							},
							{
								field: 'field-10',
								operator: 'contains',
								value: 'urgent',
							},
						],
					},
				],
			},
			baseFields
		);
		const orArgs = buildQueryArgs(
			7,
			{
				filters: [
					{
						relation: 'OR',
						filters: [
							{
								field: 'field-60',
								operator: 'isAny',
								value: [],
							},
							{
								field: 'field-10',
								operator: 'contains',
								value: 'urgent',
							},
						],
					},
				],
			},
			baseFields
		);

		expect( andArgs[ 'filters[0][relation]' ] ).toBe( 'AND' );
		expect( andArgs[ 'filters[0][filters][0][field]' ] ).toBe( 'field-10' );
		expect( orArgs[ 'filters[0][relation]' ] ).toBeUndefined();
		expect( orArgs[ 'filters[0][filters][0][field]' ] ).toBeUndefined();
	} );

	it( 'normalizes DataViews boolean checkbox filters to server checkbox operators', () => {
		const checkedArgs = buildQueryArgs(
			7,
			{
				filters: [
					{
						field: 'field-50',
						operator: 'is',
						value: true,
					},
				],
			},
			baseFields
		);
		const uncheckedArgs = buildQueryArgs(
			7,
			{
				filters: [
					{
						field: 'field-50',
						operator: 'isNot',
						value: true,
					},
				],
			},
			baseFields
		);

		expect( checkedArgs[ 'filters[0][operator]' ] ).toBe( 'isChecked' );
		expect( checkedArgs[ 'filters[0][value]' ] ).toBeUndefined();
		expect( uncheckedArgs[ 'filters[0][operator]' ] ).toBe( 'isUnchecked' );
		expect( uncheckedArgs[ 'filters[0][value]' ] ).toBeUndefined();
		expect(
			buildQueryPlan(
				7,
				{
					filters: [
						{
							field: 'field-50',
							operator: 'is',
							value: false,
						},
					],
				},
				baseFields
			).mode
		).toBe( 'server' );
	} );

	it( 'refetches when select and checkbox filters become complete server filters', async () => {
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
				filters: [
					{
						field: 'field-60',
						operator: 'isAny',
						value: [ 'Finished' ],
					},
				],
				page: 1,
				perPage: 25,
			},
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( lastRequestPath() ).toContain( 'filters[0][field]=field-60' );
		expect( lastRequestPath() ).toContain( 'filters[0][operator]=isAny' );
		expect( lastRequestPath() ).toContain(
			'filters[0][value][0]=Finished'
		);

		rerender( {
			view: {
				type: 'table',
				filters: [
					{
						field: 'field-50',
						operator: 'is',
						value: true,
					},
				],
				page: 1,
				perPage: 25,
			},
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 3 ) );
		expect( lastRequestPath() ).toContain( 'filters[0][field]=field-50' );
		expect( lastRequestPath() ).toContain(
			'filters[0][operator]=isChecked'
		);
	} );

	it( 'uses field operators instead of inferring support from type', () => {
		const view = {
			filters: [
				{
					field: 'field-10',
					operator: 'contains',
					value: 'alpha',
				},
			],
		};

		expect(
			buildQueryPlan( 7, view, [
				{
					id: 'field-10',
					recordId: 10,
					cortextType: 'text',
					sortable: true,
					filterable: true,
					operators: [ 'contains' ],
				},
			] ).mode
		).toBe( 'server' );

		expect(
			buildQueryPlan( 7, view, [
				{
					id: 'field-10',
					recordId: 10,
					cortextType: 'text',
					sortable: true,
					filterable: true,
					operators: [ 'is' ],
				},
			] ).mode
		).toBe( 'client' );
	} );

	it( 'treats missing operator metadata as unsupported', () => {
		const plan = buildQueryPlan(
			7,
			{
				filters: [
					{
						field: 'field-10',
						operator: 'contains',
						value: 'alpha',
					},
				],
			},
			[
				{
					id: 'field-10',
					recordId: 10,
					cortextType: 'text',
					sortable: true,
					filterable: true,
				},
			]
		);

		expect( plan.mode ).toBe( 'client' );
	} );

	it( 'does not serialize unsupported sorts in direct query args', () => {
		const args = buildQueryArgs(
			7,
			{
				sort: {
					field: 'field-30',
					direction: 'asc',
				},
				filters: [],
			},
			baseFields
		);

		expect( args[ 'sort[field]' ] ).toBeUndefined();
		expect( args[ 'sort[direction]' ] ).toBeUndefined();
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
		expect( lastRequestPath() ).toContain( 'per_page=100' );
	} );

	it( 'refetches rows when the visible schema gains a rollup field', async () => {
		const view = { type: 'table', filters: [], page: 1, perPage: 25 };
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

	it( 'refetches rows when a global row invalidation event fires', async () => {
		const view = { type: 'table', filters: [], page: 1, perPage: 25 };

		renderHook( () => useCollectionRows( 7, view, baseFields ) );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		act( () => {
			notifyCollectionRowsChanged();
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( lastRequestPath() ).toContain( 'collection=7' );
	} );
} );
