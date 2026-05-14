import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useTrashedRows from '../../../src/hooks/useTrashedRows';
import { COLLECTION_ROWS_CHANGED_EVENT } from '../../../src/hooks/rowInvalidation';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( { rows: [], total: 0 } );
} );

it( 'fetches trashed rows', async () => {
	const row = {
		id: 10,
		title: { raw: 'Archived', rendered: 'Archived' },
		collection: { id: 2, title: { raw: 'Books' } },
	};
	apiFetch.mockResolvedValueOnce( { rows: [ row ], total: 1 } );

	const { result } = renderHook( () => useTrashedRows() );

	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/cortext/v1/rows/trash',
	} );
	expect( result.current.rows ).toEqual( [ row ] );
	expect( result.current.total ).toBe( 1 );
	expect( result.current.error ).toBeNull();
} );

it( 'keeps cached rows visible during a refresh', async () => {
	const row = { id: 10, title: { raw: 'Cached' } };
	apiFetch.mockResolvedValueOnce( { rows: [ row ], total: 1 } );

	const { result } = renderHook( () => useTrashedRows() );
	await waitFor( () => expect( result.current.rows ).toEqual( [ row ] ) );

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
	expect( result.current.rows ).toEqual( [ row ] );

	await act( async () => {
		resolveRefresh( { rows: [], total: 0 } );
	} );

	await waitFor( () => expect( result.current.rows ).toEqual( [] ) );
} );

it( 'surfaces fetch errors without dropping cached rows', async () => {
	const row = { id: 10, title: { raw: 'Cached' } };
	apiFetch.mockResolvedValueOnce( { rows: [ row ], total: 1 } );

	const { result } = renderHook( () => useTrashedRows() );
	await waitFor( () => expect( result.current.rows ).toEqual( [ row ] ) );

	const error = new Error( 'nope' );
	apiFetch.mockRejectedValueOnce( error );

	act( () => {
		result.current.refresh();
	} );

	await waitFor( () => expect( result.current.error ).toBe( error ) );
	expect( result.current.rows ).toEqual( [ row ] );
	expect( result.current.total ).toBe( 1 );
} );

it( 'refreshes when collection rows change', async () => {
	const { result } = renderHook( () => useTrashedRows() );
	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	act( () => {
		window.dispatchEvent(
			new CustomEvent( COLLECTION_ROWS_CHANGED_EVENT, {
				detail: { collectionId: 7 },
			} )
		);
	} );

	await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
} );
