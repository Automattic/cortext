import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useArchivedDocuments from '../../../src/hooks/useArchivedDocuments';
import { DOCUMENT_ARCHIVE_CHANGED_EVENT } from '../../../src/hooks/documentArchiveInvalidation';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( { documents: [], total: 0 } );
} );

it( 'fetches archived documents through the lifecycle filter', async () => {
	const document = { id: 10, title: 'Finished project' };
	apiFetch.mockResolvedValueOnce( { documents: [ document ], total: 1 } );

	const { result } = renderHook( () => useArchivedDocuments() );

	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/cortext/v1/documents?status=crtxt_archived',
	} );
	expect( result.current.documents ).toEqual( [ document ] );
	expect( result.current.total ).toBe( 1 );
} );

it( 'refreshes when the archive lifecycle changes', async () => {
	const { result } = renderHook( () => useArchivedDocuments() );
	await waitFor( () => expect( result.current.hasResolved ).toBe( true ) );

	act( () => {
		window.dispatchEvent(
			new CustomEvent( DOCUMENT_ARCHIVE_CHANGED_EVENT )
		);
	} );

	await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 2 ) );
} );
