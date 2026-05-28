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
		expect( lastRequestPath() ).toContain( 'trait=7' );
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

	it( 'treats manual sort as the default row order', () => {
		const plan = buildQueryPlan(
			7,
			{
				sort: { field: 'manual', direction: 'asc' },
				page: 1,
				perPage: 25,
			},
			baseFields
		);

		expect( plan.mode ).toBe( 'server' );
		expect( plan.args[ 'sort[field]' ] ).toBeUndefined();
		expect( plan.args[ 'sort[direction]' ] ).toBeUndefined();
	} );

	it( 'uses default row order in forced client mode fetches', () => {
		const plan = buildQueryPlan(
			7,
			{
				sort: { field: 'manual', direction: 'asc' },
				page: 2,
				perPage: 25,
			},
			baseFields,
			{ forceClient: true }
		);

		expect( plan.mode ).toBe( 'client' );
		expect( plan.args.page ).toBe( 1 );
		expect( plan.args.per_page ).toBe( 100 );
		expect( plan.args[ 'sort[field]' ] ).toBeUndefined();
		expect( plan.args[ 'sort[direction]' ] ).toBeUndefined();
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

	it( 'does not refetch rows when the schema gains a scalar field', async () => {
		const view = { type: 'table', filters: [], page: 1, perPage: 25 };
		const initialFields = [
			{ id: 'title', cortextType: 'title' },
			{ id: 'field-10', recordId: 10, cortextType: 'text' },
		];
		const nextFields = [
			...initialFields,
			{ id: 'field-20', recordId: 20, cortextType: 'number' },
		];

		const { rerender } = renderHook(
			( { fields } ) => useCollectionRows( 7, view, fields ),
			{ initialProps: { fields: initialFields } }
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		rerender( { fields: nextFields } );

		await new Promise( ( r ) => setTimeout( r, 30 ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'refetches when schema capabilities change the query plan', async () => {
		const view = {
			type: 'table',
			filters: [],
			sort: { field: 'field-10', direction: 'asc' },
			page: 1,
			perPage: 25,
		};
		const unsupportedSortFields = [
			{
				id: 'field-10',
				recordId: 10,
				cortextType: 'relation',
				sortable: false,
				filterable: false,
				operators: [],
			},
		];
		const supportedSortFields = [
			{
				id: 'field-10',
				recordId: 10,
				cortextType: 'text',
				sortable: true,
				filterable: true,
				operators: textOperators,
			},
		];

		const { rerender, result } = renderHook(
			( { fields } ) => useCollectionRows( 7, view, fields ),
			{ initialProps: { fields: unsupportedSortFields } }
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( result.current.queryMode ).toBe( 'client' );

		rerender( { fields: supportedSortFields } );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( result.current.queryMode ).toBe( 'server' );
		expect( lastRequestPath() ).toContain( 'sort[field]=field-10' );
	} );

	it( 'refetches rows when a global row invalidation event fires', async () => {
		const view = { type: 'table', filters: [], page: 1, perPage: 25 };

		renderHook( () => useCollectionRows( 7, view, baseFields ) );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		act( () => {
			notifyCollectionRowsChanged();
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( lastRequestPath() ).toContain( 'trait=7' );
	} );

	it( 'serializes visible fields in a stable order', () => {
		const args = buildQueryArgs(
			7,
			{
				fields: [ 'title', 'field-20', 'field-10' ],
			},
			baseFields
		);

		// Sorting keeps the request key stable when columns move.
		expect( args[ 'fields[0]' ] ).toBe( 'field-10' );
		expect( args[ 'fields[1]' ] ).toBe( 'field-20' );
		expect( args[ 'fields[2]' ] ).toBe( 'title' );
	} );

	it( 'omits fields[] when every custom field is visible', () => {
		// This is the auto-seeded default: title plus every custom field.
		// Asking the server for the same set would only change the request key
		// when the seeder writes view.fields.
		const allCustomFields = baseFields
			.filter( ( f ) => /^field-/.test( f.id ) )
			.map( ( f ) => f.id );
		const args = buildQueryArgs(
			7,
			{ fields: [ 'title', ...allCustomFields ] },
			baseFields
		);

		expect( args[ 'fields[0]' ] ).toBeUndefined();
	} );

	it( 'omits fields[] while view.fields is empty or missing', () => {
		const emptyArgs = buildQueryArgs( 7, { fields: [] }, baseFields );
		const missingArgs = buildQueryArgs( 7, {}, baseFields );

		expect( emptyArgs[ 'fields[0]' ] ).toBeUndefined();
		expect( missingArgs[ 'fields[0]' ] ).toBeUndefined();
	} );

	it( 'does not project client mode requests because local filters need every column', () => {
		const plan = buildQueryPlan(
			7,
			{
				fields: [ 'title', 'field-10' ],
				filters: [
					{
						field: 'field-30',
						operator: 'contains',
						value: 'unsupported',
					},
				],
			},
			baseFields
		);

		expect( plan.mode ).toBe( 'client' );
		expect( plan.args[ 'fields[0]' ] ).toBeUndefined();
	} );

	it( 'refetches when the visible fields change', async () => {
		const initialView = {
			type: 'table',
			fields: [ 'title' ],
			page: 1,
			perPage: 25,
		};
		const nextView = {
			type: 'table',
			fields: [ 'title', 'field-10' ],
			page: 1,
			perPage: 25,
		};

		const { rerender } = renderHook(
			( { view } ) => useCollectionRows( 7, view, baseFields ),
			{ initialProps: { view: initialView } }
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( lastRequestPath() ).toContain( 'fields[0]=title' );
		expect( lastRequestPath() ).not.toContain( 'fields[1]' );

		rerender( { view: nextView } );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( lastRequestPath() ).toContain( 'fields[0]=field-10' );
		expect( lastRequestPath() ).toContain( 'fields[1]=title' );
	} );

	it( 'reuses rows when adding a newly-created field to the projection', async () => {
		const initialView = {
			type: 'table',
			fields: [ 'title', 'field-10' ],
			page: 1,
			perPage: 25,
		};
		const nextView = {
			...initialView,
			fields: [ 'title', 'field-10', 'field-70' ],
		};
		const nextFields = [
			...baseFields,
			{
				id: 'field-70',
				recordId: 70,
				cortextType: 'text',
				sortable: true,
				filterable: true,
				operators: textOperators,
			},
		];

		const { result, rerender } = renderHook(
			( { view, fields } ) => useCollectionRows( 7, view, fields ),
			{ initialProps: { view: initialView, fields: baseFields } }
		);

		await waitFor( () =>
			expect( result.current.hasResolved ).toBe( true )
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( lastRequestPath() ).toContain( 'fields[0]=field-10' );
		expect( lastRequestPath() ).toContain( 'fields[1]=title' );

		rerender( { view: nextView, fields: nextFields } );

		await new Promise( ( r ) => setTimeout( r, 30 ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( result.current.isLoading ).toBe( false );
		expect( result.current.hasResolved ).toBe( true );
	} );

	it( 'includes a newly-created projected field on the next explicit refresh', async () => {
		const initialView = {
			type: 'table',
			fields: [ 'title', 'field-10' ],
			page: 1,
			perPage: 25,
		};
		const nextView = {
			...initialView,
			fields: [ 'title', 'field-10', 'field-70' ],
		};
		const nextFields = [
			...baseFields,
			{
				id: 'field-70',
				recordId: 70,
				cortextType: 'text',
				sortable: true,
				filterable: true,
				operators: textOperators,
			},
		];

		const { result, rerender } = renderHook(
			( { view, fields } ) => useCollectionRows( 7, view, fields ),
			{ initialProps: { view: initialView, fields: baseFields } }
		);

		await waitFor( () =>
			expect( result.current.hasResolved ).toBe( true )
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		rerender( { view: nextView, fields: nextFields } );

		await new Promise( ( r ) => setTimeout( r, 30 ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		act( () => {
			result.current.refresh();
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
		expect( lastRequestPath() ).toContain( 'fields[0]=field-10' );
		expect( lastRequestPath() ).toContain( 'fields[1]=field-70' );
		expect( lastRequestPath() ).toContain( 'fields[2]=title' );
	} );

	it( 'does not refetch for a column reorder', async () => {
		const initialView = {
			type: 'table',
			fields: [ 'title', 'field-10', 'field-20' ],
			page: 1,
			perPage: 25,
		};
		const reorderedView = {
			...initialView,
			fields: [ 'field-20', 'title', 'field-10' ],
		};

		const { rerender } = renderHook(
			( { view } ) => useCollectionRows( 7, view, baseFields ),
			{ initialProps: { view: initialView } }
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		rerender( { view: reorderedView } );

		// A reorder only changes the table layout, not the request.
		await new Promise( ( r ) => setTimeout( r, 30 ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );
} );
