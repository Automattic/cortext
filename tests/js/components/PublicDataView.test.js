import { render, screen } from '@testing-library/react';
import { DataViews as mockDataViews } from '@wordpress/dataviews';

const mockFilterSortAndPaginate = jest.fn();

jest.mock( '@wordpress/dataviews', () => {
	const MockDataViews = jest.fn( ( { data = [] } ) => (
		<div data-testid="dataviews">
			{ data.map( ( item ) => (
				<span key={ item.id }>{ item.title?.rendered }</span>
			) ) }
		</div>
	) );

	return {
		DataViews: MockDataViews,
		filterSortAndPaginate: ( ...args ) =>
			mockFilterSortAndPaginate( ...args ),
	};
} );

jest.mock( '../../../src/hooks/usePublicRows', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import PublicDataView, {
	PublicDataViewErrorBoundary,
	normalizePublicView,
} from '../../../src/components/PublicDataView';
import { buildPublicFields } from '../../../src/hooks/publicFieldMapping';
import usePublicRows from '../../../src/hooks/usePublicRows';

const rows = [
	{ id: 3, title: { rendered: 'Gamma Manual' }, meta: {} },
	{ id: 1, title: { rendered: 'Alpha Manual' }, meta: {} },
	{ id: 2, title: { rendered: 'Beta Manual' }, meta: {} },
];

const fieldDefs = [
	{
		id: 11,
		label: 'Priority',
		type: 'text',
		options: null,
	},
];

function defaultDataViewsImplementation( { data = [] } ) {
	return (
		<div data-testid="dataviews">
			{ data.map( ( item ) => (
				<span key={ item.id }>{ item.title?.rendered }</span>
			) ) }
		</div>
	);
}

function renderVisibleFieldCells( { data = [], fields = [], view = {} } ) {
	const fieldIds =
		Array.isArray( view.fields ) && view.fields.length > 0
			? view.fields
			: fields.map( ( field ) => field.id );

	return (
		<div data-testid="dataviews">
			{ data.map( ( item ) =>
				fieldIds.map( ( fieldId ) => {
					const field = fields.find(
						( candidate ) => candidate.id === fieldId
					);
					if ( ! field ) {
						return null;
					}
					return (
						<div key={ `${ item.id }-${ field.id }` }>
							{ field.render( { item } ) }
						</div>
					);
				} )
			) }
		</div>
	);
}

function renderPublicDataView( view ) {
	return render( <PublicDataView collectionId={ 7 } view={ view } /> );
}

beforeEach( () => {
	mockDataViews.mockClear();
	mockDataViews.mockImplementation( defaultDataViewsImplementation );
	mockFilterSortAndPaginate.mockReset();
	mockFilterSortAndPaginate.mockImplementation( ( data ) => ( {
		data: Array.isArray( data ) ? data : [],
		paginationInfo: { totalItems: data?.length ?? 0, totalPages: 1 },
	} ) );
	usePublicRows.mockReset();
	usePublicRows.mockReturnValue( {
		data: rows,
		fields: fieldDefs,
		isLoading: false,
	} );
} );

describe( 'normalizePublicView', () => {
	it( 'coerces unsafe public view values into DataViews-safe shapes', () => {
		const view = normalizePublicView( {
			type: 'grid',
			fields: null,
			filters: null,
			sort: { field: '', direction: 'sideways' },
			layout: { badgeFields: { invalid: true }, styles: 'wide' },
			layoutByType: 'bad',
			fieldsByType: { grid: 'field-11', list: null },
		} );

		expect( view.type ).toBe( 'grid' );
		expect( view.fields ).toEqual( [] );
		expect( view.filters ).toEqual( [] );
		expect( view.sort ).toBeNull();
		expect( view.layout.badgeFields ).toBeUndefined();
		expect( view.layout.styles ).toBeUndefined();
		expect( view.layoutByType ).toEqual( {
			table: { density: 'compact' },
			grid: {},
			list: {},
		} );
		expect( view.fieldsByType ).toEqual( { grid: [], list: [] } );
	} );
} );

describe( 'PublicDataView', () => {
	it.each( [
		[ 'null fields', { type: 'table', fields: null, sort: null } ],
		[ 'missing fields', { type: 'table', sort: null } ],
		[
			'invalid buckets',
			{
				type: 'list',
				fields: [ 'title' ],
				fieldsByType: { grid: null, list: 'field-11' },
				layoutByType: 'bad',
				filters: null,
				sort: null,
			},
		],
	] )( 'renders DataViews when the saved view has %s', ( _label, view ) => {
		expect( () => renderPublicDataView( view ) ).not.toThrow();

		expect( screen.getByTestId( 'dataviews' ) ).toBeInTheDocument();

		const rowRequestView = usePublicRows.mock.calls.at( -1 )[ 1 ];
		const dataViewsView = mockDataViews.mock.calls.at( -1 )[ 0 ].view;
		expect( Array.isArray( rowRequestView.fields ) ).toBe( true );
		expect( Array.isArray( dataViewsView.fields ) ).toBe( true );
		expect( Array.isArray( rowRequestView.filters ) ).toBe( true );
	} );

	it( 'keeps REST row order when the saved public view uses manual sort', () => {
		renderPublicDataView( {
			type: 'table',
			fields: [ 'title' ],
			sort: { field: 'manual', direction: 'asc' },
			filters: [],
			page: 1,
			perPage: 25,
		} );

		expect( mockFilterSortAndPaginate ).toHaveBeenCalledWith(
			rows,
			expect.objectContaining( { sort: null } ),
			expect.any( Array )
		);
		expect(
			mockDataViews.mock.calls
				.at( -1 )[ 0 ]
				.data.map( ( item ) => item.title.rendered )
		).toEqual( [ 'Gamma Manual', 'Alpha Manual', 'Beta Manual' ] );
	} );

	it( 'drops saved public sort before fetching or rendering DataViews', () => {
		usePublicRows.mockReturnValue( {
			data: [
				{
					id: 20,
					title: { rendered: 'Later author' },
					meta: { 'field-33': 1972 },
				},
				{
					id: 21,
					title: { rendered: 'Earlier author' },
					meta: { 'field-33': 1882 },
				},
			],
			fields: [
				{
					id: 33,
					label: 'Born',
					type: 'number',
					options: null,
				},
			],
			isLoading: false,
		} );

		renderPublicDataView( {
			type: 'table',
			fields: [ 'title', 'field-33' ],
			sort: { field: 'field-33', direction: 'asc' },
			filters: [],
		} );

		expect( mockFilterSortAndPaginate ).toHaveBeenCalledWith(
			expect.any( Array ),
			expect.objectContaining( { sort: null } ),
			expect.any( Array )
		);
		expect( usePublicRows.mock.calls.at( -1 )[ 1 ].sort ).toBeNull();
		expect( mockDataViews.mock.calls.at( -1 )[ 0 ].view.sort ).toBeNull();
	} );

	it( 'renders public author system fields as plain text', () => {
		mockDataViews.mockImplementation( renderVisibleFieldCells );
		usePublicRows.mockReturnValue( {
			data: [
				{
					id: 10,
					title: { rendered: 'Authored row' },
					created_by: 'Ada Lovelace',
					modified_by: 'Grace Hopper',
					meta: {},
				},
			],
			fields: [],
			isLoading: false,
		} );

		renderPublicDataView( {
			type: 'table',
			fields: [ 'created_by', 'modified_by' ],
			sort: null,
			filters: [],
		} );

		const dataViewFields = mockDataViews.mock.calls.at( -1 )[ 0 ].fields;
		const createdBy = dataViewFields.find(
			( field ) => field.id === 'created_by'
		);
		const modifiedBy = dataViewFields.find(
			( field ) => field.id === 'modified_by'
		);

		expect( createdBy ).toEqual(
			expect.objectContaining( {
				type: 'text',
				enableSorting: false,
			} )
		);
		expect( modifiedBy ).toEqual(
			expect.objectContaining( {
				type: 'text',
				enableSorting: false,
			} )
		);
		expect( screen.getByText( 'Ada Lovelace' ) ).toHaveClass(
			'cortext-cell-readonly'
		);
		expect( screen.getByText( 'Grace Hopper' ) ).toHaveClass(
			'cortext-cell-readonly'
		);
		expect( screen.getByText( 'Ada Lovelace' ).closest( 'a' ) ).toBeNull();
		expect(
			screen.getByText( 'Ada Lovelace' ).closest( '.cortext-chip' )
		).toBeNull();
	} );

	it( 'renders public relation fields as plain text instead of editor chips', () => {
		mockDataViews.mockImplementation( renderVisibleFieldCells );
		usePublicRows.mockReturnValue( {
			data: [
				{
					id: 20,
					title: { rendered: 'Kindred' },
					meta: {
						'field-22': [
							{
								id: 99,
								slug: 'octavia-butler',
								title: { rendered: 'Octavia Butler' },
							},
						],
					},
				},
			],
			fields: [
				{
					id: 22,
					label: 'Author',
					type: 'relation',
					options: null,
				},
			],
			isLoading: false,
		} );

		renderPublicDataView( {
			type: 'table',
			fields: [ 'title', 'field-22' ],
			sort: null,
			filters: [],
		} );

		const author = screen.getByText( 'Octavia Butler' );
		const dataViewFields = mockDataViews.mock.calls.at( -1 )[ 0 ].fields;
		const authorField = dataViewFields.find(
			( field ) => field.id === 'field-22'
		);

		expect(
			authorField.getValue( {
				item: {
					meta: {
						'field-22': [
							{
								id: 99,
								title: { rendered: 'Octavia Butler' },
							},
						],
					},
				},
			} )
		).toBe( 'Octavia Butler' );
		expect( author.closest( 'a' ) ).toBeNull();
		expect( author.closest( '.cortext-chip' ) ).toBeNull();
		expect( author.closest( '.cortext-relation-ref' ) ).toBeNull();
	} );

	it( 'maps public number fields without a local sorter', () => {
		usePublicRows.mockReturnValue( {
			data: [
				{
					id: 20,
					title: { rendered: 'Later author' },
					meta: { 'field-33': 1972 },
				},
				{
					id: 21,
					title: { rendered: 'Earlier author' },
					meta: { 'field-33': 1882 },
				},
			],
			fields: [
				{
					id: 33,
					label: 'Born',
					type: 'number',
					options: null,
				},
			],
			isLoading: false,
		} );

		renderPublicDataView( {
			type: 'table',
			fields: [ 'title', 'field-33' ],
			sort: { field: 'field-33', direction: 'asc' },
			filters: [],
		} );

		const dataViewFields = mockDataViews.mock.calls.at( -1 )[ 0 ].fields;
		const bornField = dataViewFields.find(
			( field ) => field.id === 'field-33'
		);

		expect( bornField ).toEqual(
			expect.objectContaining( {
				type: 'integer',
				isValid: { custom: expect.any( Function ) },
				enableSorting: false,
			} )
		);
		expect( bornField.sort ).toBeUndefined();
	} );

	it( 'keeps every public field type value-safe', () => {
		const fieldCases = [
			{
				id: 41,
				label: 'Text',
				type: 'text',
				value: 'Alpha',
				emptyValue: '',
				expectedType: 'text',
			},
			{
				id: 42,
				label: 'Email',
				type: 'email',
				value: 'ada@example.com',
				emptyValue: '',
				expectedType: 'email',
			},
			{
				id: 43,
				label: 'URL',
				type: 'url',
				value: 'https://example.com',
				emptyValue: '',
				expectedType: 'text',
			},
			{
				id: 44,
				label: 'Status',
				type: 'select',
				value: 'open',
				emptyValue: '',
				expectedType: 'text',
				options: JSON.stringify( [ { value: 'open', label: 'Open' } ] ),
			},
			{
				id: 45,
				label: 'Tags',
				type: 'multiselect',
				value: [ 'alpha', 'beta' ],
				emptyValue: [],
				expectedType: 'array',
				options: JSON.stringify( [
					{ value: 'alpha', label: 'Alpha' },
					{ value: 'beta', label: 'Beta' },
				] ),
			},
			{
				id: 46,
				label: 'Born',
				type: 'number',
				value: 1882,
				emptyValue: null,
				expectedType: 'integer',
			},
			{
				id: 47,
				label: 'Published',
				type: 'date',
				value: '2026-05-31',
				emptyValue: '',
				expectedType: 'datetime',
			},
			{
				id: 48,
				label: 'Updated',
				type: 'datetime',
				value: '2026-05-31T10:00:00+00:00',
				emptyValue: '',
				expectedType: 'datetime',
			},
			{
				id: 49,
				label: 'Done',
				type: 'checkbox',
				value: true,
				emptyValue: false,
				expectedType: 'boolean',
			},
			{
				id: 50,
				label: 'Author',
				type: 'relation',
				value: [
					{
						id: 99,
						title: { rendered: 'Octavia Butler' },
					},
				],
				emptyValue: '',
				expectedType: 'text',
			},
			{
				id: 51,
				label: 'Computed',
				type: 'rollup',
				value: { title: { rendered: 'Computed value' } },
				emptyValue: '',
				expectedType: 'text',
			},
		];

		const fields = buildPublicFields(
			fieldCases.map( ( field ) => ( {
				id: field.id,
				label: field.label,
				type: field.type,
				options: field.options ?? null,
			} ) )
		);
		const filledItem = {
			id: 100,
			title: { rendered: 'Filled row' },
			created_at: '2026-05-31T10:00:00+00:00',
			created_by: 'Ada Lovelace',
			modified_at: '2026-05-31T11:00:00+00:00',
			modified_by: 'Grace Hopper',
			meta: Object.fromEntries(
				fieldCases.map( ( field ) => [
					`field-${ field.id }`,
					field.value,
				] )
			),
		};
		const emptyItem = {
			id: 101,
			title: { rendered: null },
			meta: {},
		};

		for ( const fieldCase of fieldCases ) {
			const field = fields.find(
				( candidate ) => candidate.id === `field-${ fieldCase.id }`
			);

			expect( field.type ).toBe( fieldCase.expectedType );
			expect( field.getValue( { item: emptyItem } ) ).toEqual(
				fieldCase.emptyValue
			);
			expect( () =>
				field.getValue( { item: filledItem } )
			).not.toThrow();
			expect( field.sort ).toBeUndefined();
			expect( field.enableSorting ).toBe( false );
		}

		for ( const fieldId of [
			'title',
			'created_at',
			'created_by',
			'modified_at',
			'modified_by',
		] ) {
			const field = fields.find(
				( candidate ) => candidate.id === fieldId
			);

			expect( () =>
				field.getValue( { item: filledItem } )
			).not.toThrow();
			expect( () => field.getValue( { item: emptyItem } ) ).not.toThrow();
			expect( field.sort ).toBeUndefined();
			expect( field.enableSorting ).toBe( false );
		}
	} );

	it( 'shows a local fallback when a public DataView render throws', () => {
		function ThrowingDataView() {
			throw new Error( 'DataViews failed' );
		}

		render(
			<PublicDataViewErrorBoundary>
				<ThrowingDataView />
			</PublicDataViewErrorBoundary>
		);

		expect( screen.getByRole( 'status' ) ).toHaveTextContent(
			"We couldn't load this collection view."
		);
		expect( console ).toHaveErrored();
	} );
} );
