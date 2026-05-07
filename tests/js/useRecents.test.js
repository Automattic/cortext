/**
 * Tests for `src/hooks/useRecents.js`.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import { RecentsProvider, useRecents } from '../../src/hooks/useRecents';

function wrapper( { children } ) {
	return <RecentsProvider>{ children }</RecentsProvider>;
}

function createDeferred() {
	const deferred = {};
	deferred.promise = new Promise( ( resolve, reject ) => {
		deferred.resolve = resolve;
		deferred.reject = reject;
	} );
	return deferred;
}

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'useRecents', () => {
	it( 'fetches recents on mount', async () => {
		const recent = {
			kind: 'page',
			id: 7,
			title: 'Notes',
			path: 'page/notes-7',
			updatedAt: '2026-05-07T12:00:00+00:00',
		};
		apiFetch.mockResolvedValueOnce( { recents: [ recent ] } );

		const { result } = renderHook( () => useRecents(), { wrapper } );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/recents',
		} );
		expect( result.current.recents ).toEqual( [ recent ] );
	} );

	it( 'touches a recent and replaces state from the response', async () => {
		const recent = {
			kind: 'collection',
			id: 9,
			title: 'Books',
			path: 'collection/books-9',
			updatedAt: '2026-05-07T12:00:00+00:00',
		};
		apiFetch
			.mockResolvedValueOnce( { recents: [] } )
			.mockResolvedValueOnce( { recents: [ recent ] } );

		const { result } = renderHook( () => useRecents(), { wrapper } );
		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		await act( async () => {
			await result.current.touchRecent( {
				kind: 'collection',
				id: 9,
			} );
		} );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/cortext/v1/recents',
			method: 'POST',
			data: { kind: 'collection', id: 9 },
		} );
		expect( result.current.recents ).toEqual( [ recent ] );
	} );

	it( 'swallows touch failures without clearing existing recents', async () => {
		const recent = {
			kind: 'page',
			id: 7,
			title: 'Notes',
			path: 'page/notes-7',
			updatedAt: '2026-05-07T12:00:00+00:00',
		};
		apiFetch
			.mockResolvedValueOnce( { recents: [ recent ] } )
			.mockRejectedValueOnce( new Error( 'nope' ) );

		const { result } = renderHook( () => useRecents(), { wrapper } );
		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		let response;
		await act( async () => {
			response = await result.current.touchRecent( {
				kind: 'page',
				id: 7,
			} );
		} );

		expect( response ).toBeNull();
		expect( result.current.recents ).toEqual( [ recent ] );
		expect( result.current.error ).toBeInstanceOf( Error );
	} );

	it( 'ignores stale touch responses when requests resolve out of order', async () => {
		const staleTouch = createDeferred();
		const latestTouch = createDeferred();
		const firstRecent = {
			kind: 'page',
			id: 1,
			title: 'First',
			path: 'page/first-1',
			updatedAt: '2026-05-07T12:00:00+00:00',
		};
		const secondRecent = {
			kind: 'page',
			id: 2,
			title: 'Second',
			path: 'page/second-2',
			updatedAt: '2026-05-07T12:01:00+00:00',
		};
		apiFetch
			.mockResolvedValueOnce( { recents: [] } )
			.mockReturnValueOnce( staleTouch.promise )
			.mockReturnValueOnce( latestTouch.promise );

		const { result } = renderHook( () => useRecents(), { wrapper } );
		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		let firstResponse;
		let secondResponse;
		act( () => {
			firstResponse = result.current.touchRecent( {
				kind: 'page',
				id: 1,
			} );
		} );
		act( () => {
			secondResponse = result.current.touchRecent( {
				kind: 'page',
				id: 2,
			} );
		} );

		await act( async () => {
			latestTouch.resolve( { recents: [ secondRecent ] } );
			await secondResponse;
		} );
		expect( result.current.recents ).toEqual( [ secondRecent ] );

		await act( async () => {
			staleTouch.resolve( { recents: [ firstRecent ] } );
			await firstResponse;
		} );
		expect( result.current.recents ).toEqual( [ secondRecent ] );
	} );

	it( 'keeps equivalent recents state stable when only timestamps change', async () => {
		const recent = {
			kind: 'page',
			id: 7,
			title: 'Notes',
			path: 'page/notes-7',
			updatedAt: '2026-05-07T12:00:00+00:00',
		};
		apiFetch
			.mockResolvedValueOnce( { recents: [ recent ] } )
			.mockResolvedValueOnce( {
				recents: [
					{
						...recent,
						updatedAt: '2026-05-07T12:01:00+00:00',
					},
				],
			} );

		const { result } = renderHook( () => useRecents(), { wrapper } );
		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		const recentsBeforeTouch = result.current.recents;

		await act( async () => {
			await result.current.touchRecent( {
				kind: 'page',
				id: 7,
			} );
		} );

		expect( result.current.recents ).toBe( recentsBeforeTouch );
	} );
} );
