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

	it( 'preserves REST row order when the saved public view uses manual sort', () => {
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
		expect( author.closest( 'a' ) ).toBeNull();
		expect( author.closest( '.cortext-chip' ) ).toBeNull();
		expect( author.closest( '.cortext-relation-ref' ) ).toBeNull();
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
