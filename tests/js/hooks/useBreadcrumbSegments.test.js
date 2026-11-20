import { renderHook } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
	useEntityRecord: jest.fn(),
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => ( {
	useSelect: jest.fn(),
} ) );

jest.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => jest.fn(),
} ) );

import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import useBreadcrumbSegments from '../../../src/hooks/useBreadcrumbSegments';

const page = { id: 4, parent: 0, title: { raw: 'Workspace' } };
const collection = { id: 10, parent: 4, title: { raw: 'Invoices' } };
const row = { id: 50, parent: 0, crtxt_trait: [ 7 ], title: { raw: 'INV-1' } };
const term = { id: 7, slug: '10' };

let lists;
let byId;
const getEntityRecord = jest.fn( ( kind, name, id ) => byId[ kind ]?.[ id ] );

function labels() {
	const { result } = renderHook( () => useBreadcrumbSegments( row.id ) );
	return result.current.map( ( segment ) => segment.label );
}

beforeEach( () => {
	jest.clearAllMocks();
	lists = { pages: [], collections: [], terms: [] };
	byId = {
		postType: { 4: page, 10: collection, 50: row },
		taxonomy: { 7: term },
	};
	useEntityRecord.mockReturnValue( { record: row } );
	useEntityRecords.mockImplementation( ( kind, name, query ) => {
		if ( kind === 'taxonomy' ) {
			return { records: lists.terms };
		}
		return {
			records: query.cortext_collections
				? lists.collections
				: lists.pages,
		};
	} );
	useSelect.mockImplementation( ( mapSelect ) =>
		mapSelect( () => ( { getEntityRecord } ) )
	);
} );

describe( 'useBreadcrumbSegments', () => {
	it( 'builds the chain from the cached lists without fetching by id', () => {
		lists = {
			pages: [ page ],
			collections: [ collection ],
			terms: [ term ],
		};

		expect( labels() ).toEqual( [ 'Workspace', 'Invoices', 'INV-1' ] );
		expect( getEntityRecord ).not.toHaveBeenCalled();
	} );

	it( 'resolves ancestors missing from the cached lists by id', () => {
		expect( labels() ).toEqual( [ 'Workspace', 'Invoices', 'INV-1' ] );
	} );

	it( 'reads fallback terms in view context, like the terms list', () => {
		labels();

		expect( getEntityRecord ).toHaveBeenCalledWith(
			'taxonomy',
			'crtxt_trait',
			7,
			{ context: 'view' }
		);
	} );

	it( 'stops at the last ancestor that has loaded', () => {
		delete byId.postType[ 10 ];

		expect( labels() ).toEqual( [ 'INV-1' ] );
	} );
} );
