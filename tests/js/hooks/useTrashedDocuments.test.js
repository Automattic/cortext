import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useTrashedDocuments from '../../../src/hooks/useTrashedDocuments';
import { DOCUMENT_TRASH_CHANGED_EVENT } from '../../../src/hooks/documentTrashInvalidation';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( { documents: [], total: 0 } );
} );

it( 'fetches trashed documents', async () => {
	const document = {
		id: 10,
		kind: 'row',
		title: { raw: 'Archived', rendered: 'Archived' },
		collection: { id: 2, title: { raw: 'Books' } },
	};
	apiFetch.mockResolvedValueOnce( { documents: [ document ], total: 1 } );

	const { result } = renderHook( () => useTrashedDocuments() );

	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/cortext/v1/documents?status=trash',
	} );
	expect( result.current.documents ).toEqual( [ document ] );
	expect( result.current.total ).toBe( 1 );
	expect( result.current.error ).toBeNull();
} );

it( 'keeps cached documents visible during a refresh', async () => {
	const document = { id: 10, title: { raw: 'Cached' } };
	apiFetch.mockResolvedValueOnce( { documents: [ document ], total: 1 } );

	const { result } = renderHook( () => useTrashedDocuments() );
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

it( 'keeps cached documents when a refresh fails', async () => {
	const document = { id: 10, title: { raw: 'Cached' } };
	apiFetch.mockResolvedValueOnce( { documents: [ document ], total: 1 } );

	const { result } = renderHook( () => useTrashedDocuments() );
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

it( 'refreshes when document trash changes', async () => {
	const { result } = renderHook( () => useTrashedDocuments() );
	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	act( () => {
		window.dispatchEvent( new CustomEvent( DOCUMENT_TRASH_CHANGED_EVENT ) );
	} );

	await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
} );
