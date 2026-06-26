import { render, screen } from '@testing-library/react';

jest.mock( '@wordpress/i18n', () => ( {
	__: ( value ) => value,
	_n: ( single, plural, count ) => ( count === 1 ? single : plural ),
	sprintf: ( value ) => value,
} ) );

jest.mock( '@wordpress/components', () => {
	const ReactLib = require( 'react' );
	return {
		__esModule: true,
		Button: ( { children, onClick, className } ) =>
			ReactLib.createElement(
				'button',
				{ type: 'button', className, onClick },
				children
			),
		ExternalLink: ( { children, href } ) =>
			ReactLib.createElement( 'a', { href }, children ),
		Spinner: () =>
			ReactLib.createElement( 'div', { 'data-testid': 'spinner' } ),
		__experimentalHeading: ( { children, level = 2 } ) =>
			ReactLib.createElement( `h${ level }`, null, children ),
		__experimentalText: ( { children } ) =>
			ReactLib.createElement( 'span', null, children ),
		__experimentalVStack: ( { children, className } ) =>
			ReactLib.createElement( 'div', { className }, children ),
	};
} );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '@wordpress/dataviews/wp', () => {
	const ReactLib = require( 'react' );
	return {
		__esModule: true,
		DataViews: jest.fn( ( { data, fields, getItemId } ) =>
			ReactLib.createElement(
				'div',
				{ 'data-testid': 'dataviews' },
				data.map( ( item ) => {
					const itemId = getItemId( item );
					return ReactLib.createElement(
						'div',
						{
							key: itemId,
							role: 'row',
							'data-testid': itemId,
						},
						fields.map( ( field ) =>
							ReactLib.createElement(
								'div',
								{
									key: field.id,
									'data-testid': `${ itemId }-${ field.id }`,
								},
								field.render
									? field.render( { item } )
									: field.getValue( { item } )
							)
						)
					);
				} )
			)
		),
		filterSortAndPaginate: jest.fn( ( data ) => ( {
			data,
			paginationInfo: {
				totalItems: data.length,
				totalPages: data.length > 0 ? 1 : 0,
			},
		} ) ),
	};
} );

jest.mock( '@wordpress/date', () => ( {
	__esModule: true,
	dateI18n: ( format, value ) => value,
	getSettings: () => ( { formats: { date: 'Y-m-d', time: 'H:i' } } ),
} ) );

jest.mock( '@tanstack/react-router', () => ( {
	__esModule: true,
	useNavigate: jest.fn(),
} ) );

jest.mock( '../../../src/components/DocumentIcon', () => ( {
	__esModule: true,
	default: ( { icon } ) => <span data-testid="document-icon">{ icon }</span>,
} ) );

import { useEntityRecords } from '@wordpress/core-data';
import { DataViews } from '@wordpress/dataviews/wp';
import { useNavigate } from '@tanstack/react-router';

import PublishedDocumentsPane from '../../../src/components/PublishedDocumentsPane';
import {
	POST_TYPE,
	PUBLISHED_DOCUMENTS_QUERY,
} from '../../../src/components/page-queries';

const navigate = jest.fn();

function documentRecord( overrides ) {
	return {
		id: 1,
		slug: 'document',
		title: { raw: 'Document' },
		modified: '2026-05-31T10:00:00',
		link: 'https://example.test/document/',
		meta: {},
		crtxt_trait: [],
		cortext_defines_trait: false,
		...overrides,
	};
}

beforeEach( () => {
	jest.clearAllMocks();
	useNavigate.mockReturnValue( navigate );
	useEntityRecords.mockReturnValue( {
		records: [],
		isResolving: false,
	} );
} );

describe( 'PublishedDocumentsPane', () => {
	it( 'loads the panel with one published document query', () => {
		render( <PublishedDocumentsPane /> );

		expect( useEntityRecords ).toHaveBeenCalledTimes( 1 );
		expect( useEntityRecords ).toHaveBeenCalledWith(
			'postType',
			POST_TYPE,
			PUBLISHED_DOCUMENTS_QUERY
		);
		expect( PUBLISHED_DOCUMENTS_QUERY ).toEqual( {
			per_page: 100,
			status: 'publish',
			context: 'edit',
		} );
		expect( PUBLISHED_DOCUMENTS_QUERY ).not.toHaveProperty(
			'cortext_no_trait'
		);
		expect( PUBLISHED_DOCUMENTS_QUERY ).not.toHaveProperty(
			'cortext_collections'
		);
		expect( PUBLISHED_DOCUMENTS_QUERY ).not.toHaveProperty(
			'cortext_no_collections'
		);
	} );

	it( 'shows pages, collection items, and collections from the same response', () => {
		useEntityRecords.mockReturnValue( {
			records: [
				documentRecord( {
					id: 10,
					slug: 'public-page',
					title: { raw: 'Public Page' },
				} ),
				documentRecord( {
					id: 20,
					slug: 'public-collection-item',
					title: { raw: 'Public Collection Item' },
					crtxt_trait: [ 99 ],
				} ),
				documentRecord( {
					id: 30,
					slug: 'public-collection',
					title: { raw: 'Public Collection' },
					cortext_defines_trait: true,
				} ),
			],
			isResolving: false,
		} );

		render( <PublishedDocumentsPane /> );

		expect( DataViews ).toHaveBeenCalledTimes( 1 );
		expect( screen.getByText( 'Public Page' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Public Collection Item' )
		).toBeInTheDocument();
		expect( screen.getByText( 'Public Collection' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'document-10-type' ) ).toHaveTextContent(
			'Page'
		);
		expect( screen.getByTestId( 'document-20-type' ) ).toHaveTextContent(
			'Collection item'
		);
		expect( screen.getByTestId( 'document-30-type' ) ).toHaveTextContent(
			'Collection'
		);

		const typeField = DataViews.mock.calls[ 0 ][ 0 ].fields.find(
			( field ) => field.id === 'type'
		);
		expect( typeField.elements ).toEqual( [
			{ value: 'page', label: 'Page' },
			{ value: 'collection-item', label: 'Collection item' },
			{ value: 'collection', label: 'Collection' },
		] );
		expect( typeField.filterBy ).toEqual( {
			operators: [ 'is', 'isAny' ],
		} );
		expect(
			DataViews.mock.calls[ 0 ][ 0 ].data.map( ( item ) =>
				typeField.getValue( { item } )
			)
		).toEqual( [ 'page', 'collection-item', 'collection' ] );
	} );
} );
