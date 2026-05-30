import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import {
	FavoritesProvider,
	useFavorites,
} from '../../../src/hooks/useFavorites';

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( promiseResolve, promiseReject ) => {
		resolve = promiseResolve;
		reject = promiseReject;
	} );
	return { promise, resolve, reject };
}

function wrapper( { children } ) {
	return <FavoritesProvider>{ children }</FavoritesProvider>;
}

beforeEach( () => {
	jest.clearAllMocks();
} );

describe( 'useFavorites', () => {
	it( 'loads the current user favorites', async () => {
		apiFetch.mockResolvedValueOnce( {
			favorites: [ { id: '7', path: 'page/notes-7' } ],
		} );

		const { result } = renderHook( () => useFavorites(), { wrapper } );

		await waitFor( () => {
			expect( result.current.isResolving ).toBe( false );
		} );

		expect( result.current.favorites ).toEqual( [
			{ id: 7, path: 'page/notes-7' },
		] );
	} );

	it( 'waits for the first load before writing updater results', async () => {
		const initialLoad = deferred();
		apiFetch.mockImplementation( ( options ) => {
			if ( options.method === 'PUT' ) {
				return Promise.resolve( {
					favorites: options.data.favorites,
				} );
			}
			return initialLoad.promise;
		} );

		const { result } = renderHook( () => useFavorites(), { wrapper } );
		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/favorites',
			} );
		} );

		let writePromise;
		act( () => {
			writePromise = result.current.setFavorites( ( current ) => [
				...current,
				{ id: 2 },
			] );
		} );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		await act( async () => {
			initialLoad.resolve( {
				favorites: [ { id: 1, path: 'page/one-1' } ],
			} );
			await writePromise;
		} );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/cortext/v1/favorites',
			method: 'PUT',
			data: {
				favorites: [ { id: 1, path: 'page/one-1' }, { id: 2 } ],
			},
		} );
	} );

	it( 'keeps a failed write from overwriting a later one', async () => {
		const firstWrite = deferred();
		const secondWrite = deferred();
		const putCalls = [];
		apiFetch.mockImplementation( ( options ) => {
			if ( options.method !== 'PUT' ) {
				return Promise.resolve( { favorites: [] } );
			}
			putCalls.push( options.data.favorites );
			if ( putCalls.length === 1 ) {
				return firstWrite.promise;
			}
			return secondWrite.promise;
		} );

		const { result } = renderHook( () => useFavorites(), { wrapper } );
		await waitFor( () => {
			expect( result.current.isResolving ).toBe( false );
		} );

		let firstPromise;
		let secondPromise;
		await act( async () => {
			firstPromise = result.current.setFavorites( [ { id: 1 } ] );
			secondPromise = result.current.setFavorites( ( current ) => [
				...current,
				{ id: 2 },
			] );
			await Promise.resolve();
		} );

		await waitFor( () => {
			expect( putCalls ).toEqual( [ [ { id: 1 } ] ] );
		} );

		await act( async () => {
			firstWrite.reject( new Error( 'first failed' ) );
			await firstPromise.catch( () => {} );
		} );
		await expect( firstPromise ).rejects.toThrow( 'first failed' );
		await waitFor( () => {
			expect( putCalls ).toEqual( [ [ { id: 1 } ], [ { id: 2 } ] ] );
		} );

		await act( async () => {
			secondWrite.resolve( {
				favorites: [ { id: 2 } ],
			} );
			await secondPromise;
		} );

		expect( result.current.favorites ).toEqual( [ { id: 2 } ] );
	} );
} );
