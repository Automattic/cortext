import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useDocuments from '../../../src/hooks/useDocuments';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( { documents: [], total: 0 } );
} );

it( 'fetches documents without filters', async () => {
	const document = {
		id: 10,
		title: 'Welcome',
		path: 'page/welcome-10',
	};
	apiFetch.mockResolvedValueOnce( { documents: [ document ], total: 1 } );

	const { result } = renderHook( () => useDocuments() );

	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/cortext/v1/documents',
	} );
	expect( result.current.documents ).toEqual( [ document ] );
	expect( result.current.total ).toBe( 1 );
	expect( result.current.error ).toBeNull();
} );

it( 'passes search and paging to the endpoint', async () => {
	apiFetch.mockResolvedValueOnce( { documents: [], total: 0 } );

	const { result } = renderHook( () =>
		useDocuments( {
			search: 'quarterly review',
			page: 2,
			perPage: 5,
		} )
	);

	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	const call = apiFetch.mock.calls[ 0 ][ 0 ];
	expect( call.path ).toContain( '/cortext/v1/documents?' );
	expect( call.path ).toContain( 'search=quarterly+review' );
	expect( call.path ).toContain( 'page=2' );
	expect( call.path ).toContain( 'per_page=5' );
} );

it( 'refetches when the search term changes', async () => {
	apiFetch.mockResolvedValue( { documents: [], total: 0 } );

	const { result, rerender } = renderHook(
		( { search } ) => useDocuments( { search } ),
		{ initialProps: { search: 'one' } }
	);
	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	rerender( { search: 'two' } );

	await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
	expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toContain( 'search=two' );
} );

it( 'keeps the last result visible while a refresh is in flight', async () => {
	const document = {
		id: 1,
		title: 'Cached',
		path: 'page/cached-1',
	};
	apiFetch.mockResolvedValueOnce( { documents: [ document ], total: 1 } );

	const { result } = renderHook( () => useDocuments() );
	await waitFor( () =>
		expect( result.current.documents ).toEqual( [ document ] )
	);

	let resolveRefresh;
	apiFetch.mockReturnValueOnce(
		new Promise( ( resolve ) => {
			resolveRefresh = resolve;
		} )
	);

	act( () => {
		result.current.refresh();
	} );

	await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
	expect( result.current.isLoading ).toBe( true );
	expect( result.current.documents ).toEqual( [ document ] );

	await act( async () => {
		resolveRefresh( { documents: [], total: 0 } );
	} );

	await waitFor( () => expect( result.current.documents ).toEqual( [] ) );
} );

it( 'reports errors without dropping the previous result', async () => {
	const document = {
		id: 1,
		title: 'Cached',
		path: 'page/cached-1',
	};
	apiFetch.mockResolvedValueOnce( { documents: [ document ], total: 1 } );

	const { result } = renderHook( () => useDocuments() );
	await waitFor( () =>
		expect( result.current.documents ).toEqual( [ document ] )
	);

	const error = new Error( 'nope' );
	apiFetch.mockRejectedValueOnce( error );

	act( () => {
		result.current.refresh();
	} );

	await waitFor( () => expect( result.current.error ).toBe( error ) );
	expect( result.current.documents ).toEqual( [ document ] );
	expect( result.current.total ).toBe( 1 );
} );
