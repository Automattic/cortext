import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useCollectionRowsByIds from '../../../src/hooks/useCollectionRowsByIds';

beforeEach( () => {
	jest.clearAllMocks();
} );

function lastRequestPath() {
	return decodeURIComponent( apiFetch.mock.calls.at( -1 )[ 0 ].path );
}

function rowsResponseFor( ids ) {
	return {
		rows: ids.map( ( id ) => ( { id, title: { raw: `Row ${ id }` } } ) ),
		collection: null,
		total: ids.length,
		totalPages: 1,
	};
}

describe( 'useCollectionRowsByIds', () => {
	it( 'does not fetch when ids is empty', async () => {
		const { result } = renderHook( () => useCollectionRowsByIds( 42, [] ) );

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( result.current.rows ).toEqual( [] );
		expect( result.current.isLoading ).toBe( false );
	} );

	it( 'does not fetch when collectionId is falsy', async () => {
		const { result } = renderHook( () =>
			useCollectionRowsByIds( null, [ 1, 2, 3 ] )
		);

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( result.current.rows ).toEqual( [] );
	} );

	it( 'fetches the requested ids via include[] params', async () => {
		apiFetch.mockResolvedValue( rowsResponseFor( [ 1, 2, 3 ] ) );

		const { result } = renderHook( () =>
			useCollectionRowsByIds( 42, [ 1, 2, 3 ] )
		);

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		const path = lastRequestPath();
		expect( path ).toContain( 'collection=42' );
		expect( path ).toContain( 'include[0]=1' );
		expect( path ).toContain( 'include[1]=2' );
		expect( path ).toContain( 'include[2]=3' );
		expect( path ).toContain( 'context=edit' );
		expect( result.current.rows.map( ( row ) => row.id ) ).toEqual( [
			1, 2, 3,
		] );
	} );

	it( 'does not mutate the caller-provided ids array', async () => {
		apiFetch.mockResolvedValue( rowsResponseFor( [ 3, 1, 2 ] ) );

		const ids = [ 3, 1, 2 ];
		const snapshot = [ ...ids ];

		renderHook( () => useCollectionRowsByIds( 42, ids ) );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		expect( ids ).toEqual( snapshot );
	} );

	it( 'reuses the cached fetch when ids change order but not contents', async () => {
		apiFetch.mockResolvedValue( rowsResponseFor( [ 1, 2, 3 ] ) );

		const { rerender } = renderHook(
			( { ids } ) => useCollectionRowsByIds( 42, ids ),
			{ initialProps: { ids: [ 1, 2, 3 ] } }
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );

		rerender( { ids: [ 3, 2, 1 ] } );
		await act( async () => {} );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'chunks more than 100 ids into parallel requests', async () => {
		// Two requests: 100 IDs, then 50.
		const firstBatchIds = Array.from( { length: 100 }, ( _, i ) => i + 1 );
		const secondBatchIds = Array.from(
			{ length: 50 },
			( _, i ) => i + 101
		);
		const allIds = [ ...firstBatchIds, ...secondBatchIds ];

		apiFetch.mockImplementation( ( { path } ) => {
			// The second batch starts its include list at 101.
			if ( decodeURIComponent( path ).includes( 'include[0]=101' ) ) {
				return Promise.resolve( rowsResponseFor( secondBatchIds ) );
			}
			return Promise.resolve( rowsResponseFor( firstBatchIds ) );
		} );

		const { result } = renderHook( () =>
			useCollectionRowsByIds( 42, allIds )
		);

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );

		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( result.current.rows ).toHaveLength( 150 );
	} );

	it( 'exposes errors and clears rows when the request fails', async () => {
		const error = new Error( 'boom' );
		apiFetch.mockRejectedValue( error );

		const { result } = renderHook( () =>
			useCollectionRowsByIds( 42, [ 1, 2 ] )
		);

		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );

		expect( result.current.rows ).toEqual( [] );
		expect( result.current.error ).toBe( error );
	} );

	it( 'ignores a stale response that resolves after ids is cleared', async () => {
		let resolveFirst;
		apiFetch.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					resolveFirst = resolve;
				} )
		);

		const { result, rerender } = renderHook(
			( { ids } ) => useCollectionRowsByIds( 42, ids ),
			{ initialProps: { ids: [ 1, 2 ] } }
		);

		rerender( { ids: [] } );
		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );
		expect( result.current.rows ).toEqual( [] );

		// The [1,2] response lands after the clear.
		await act( async () => {
			resolveFirst( rowsResponseFor( [ 1, 2 ] ) );
		} );

		expect( result.current.rows ).toEqual( [] );
	} );

	it( 'ignores stale responses when ids change mid-flight', async () => {
		let resolveFirst;
		apiFetch.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					resolveFirst = resolve;
				} )
		);
		apiFetch.mockResolvedValueOnce( rowsResponseFor( [ 9 ] ) );

		const { result, rerender } = renderHook(
			( { ids } ) => useCollectionRowsByIds( 42, ids ),
			{ initialProps: { ids: [ 1 ] } }
		);

		rerender( { ids: [ 9 ] } );
		await waitFor( () => expect( result.current.isLoading ).toBe( false ) );

		// The first response lands after the second request resolves.
		await act( async () => {
			resolveFirst( rowsResponseFor( [ 1 ] ) );
		} );

		expect( result.current.rows.map( ( row ) => row.id ) ).toEqual( [ 9 ] );
	} );
} );
