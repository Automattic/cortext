import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import {
	WorkspaceHomeProvider,
	useWorkspaceHome,
} from '../../../src/hooks/useWorkspaceHome';
import { DOCUMENT_ARCHIVE_CHANGED_EVENT } from '../../../src/hooks/documentArchiveInvalidation';

function wrapper( { children } ) {
	return <WorkspaceHomeProvider>{ children }</WorkspaceHomeProvider>;
}

function deferred() {
	let resolve;
	const promise = new Promise( ( promiseResolve ) => {
		resolve = promiseResolve;
	} );
	return { promise, resolve };
}

beforeEach( () => {
	apiFetch.mockReset();
} );

it( 'refreshes the workspace home across archive lifecycle changes', async () => {
	const home = { id: 7, path: 'notes-7' };
	apiFetch
		.mockResolvedValueOnce( { home } )
		.mockResolvedValueOnce( { home: null } )
		.mockResolvedValueOnce( { home } );

	const { result } = renderHook( () => useWorkspaceHome(), { wrapper } );
	await waitFor( () => expect( result.current.home ).toEqual( home ) );

	act( () => {
		window.dispatchEvent(
			new CustomEvent( DOCUMENT_ARCHIVE_CHANGED_EVENT, {
				detail: { action: 'archive' },
			} )
		);
	} );
	await waitFor( () => expect( result.current.home ).toBeNull() );

	act( () => {
		window.dispatchEvent(
			new CustomEvent( DOCUMENT_ARCHIVE_CHANGED_EVENT, {
				detail: { action: 'unarchive' },
			} )
		);
	} );
	await waitFor( () => expect( result.current.home ).toEqual( home ) );
	expect( apiFetch ).toHaveBeenCalledTimes( 3 );
} );

it( 'does not let an older home update overwrite an archive refresh', async () => {
	const update = deferred();
	const refresh = deferred();
	apiFetch
		.mockResolvedValueOnce( { home: { id: 7, path: 'notes-7' } } )
		.mockReturnValueOnce( update.promise )
		.mockReturnValueOnce( refresh.promise );

	const { result } = renderHook( () => useWorkspaceHome(), { wrapper } );
	await waitFor( () => expect( result.current.home?.id ).toBe( 7 ) );

	let updatePromise;
	act( () => {
		updatePromise = result.current.setHome( { id: 8 } );
	} );
	act( () => {
		window.dispatchEvent(
			new CustomEvent( DOCUMENT_ARCHIVE_CHANGED_EVENT, {
				detail: { action: 'archive' },
			} )
		);
	} );

	await act( async () => {
		refresh.resolve( { home: null } );
		await refresh.promise;
	} );
	expect( result.current.home ).toBeNull();

	await act( async () => {
		update.resolve( { home: { id: 8, path: 'other-8' } } );
		await updatePromise;
	} );
	expect( result.current.home ).toBeNull();
} );

it( 'clears resolving when a home update supersedes a pending refresh', async () => {
	const initialRefresh = deferred();
	apiFetch
		.mockReturnValueOnce( initialRefresh.promise )
		.mockResolvedValueOnce( { home: { id: 8, path: 'other-8' } } );

	const { result } = renderHook( () => useWorkspaceHome(), { wrapper } );
	expect( result.current.isResolving ).toBe( true );

	await act( async () => {
		await result.current.setHome( { id: 8 } );
	} );

	expect( result.current.home ).toEqual( { id: 8, path: 'other-8' } );
	expect( result.current.isResolving ).toBe( false );

	await act( async () => {
		initialRefresh.resolve( { home: { id: 7, path: 'notes-7' } } );
		await initialRefresh.promise;
	} );
	expect( result.current.home ).toEqual( { id: 8, path: 'other-8' } );
	expect( result.current.isResolving ).toBe( false );
} );
