import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useRelationTargetStatuses from '../../../src/hooks/useRelationTargetStatuses';
import { notifyDocumentArchiveChanged } from '../../../src/hooks/documentArchiveInvalidation';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( {
		cortext_hydrated_meta: {
			'field-5': [
				{ id: 12, title: { raw: 'Ada Lovelace' }, status: 'private' },
			],
			'field-6': 3,
		},
	} );
} );

it( 'does not fetch until a document archive change happens', () => {
	const { result } = renderHook( () => useRelationTargetStatuses( 46 ) );

	expect( apiFetch ).not.toHaveBeenCalled();
	expect( result.current ).toEqual( {} );
} );

it( 'refetches target statuses after an unarchive event', async () => {
	const { result } = renderHook( () => useRelationTargetStatuses( 46 ) );

	act( () => {
		notifyDocumentArchiveChanged( { action: 'unarchive' } );
	} );

	await waitFor( () =>
		expect( result.current ).toEqual( { 12: 'private' } )
	);
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/wp/v2/crtxt_documents/46?context=edit&_fields=cortext_hydrated_meta',
	} );
} );

it( 'drops statuses when the row changes', async () => {
	const { result, rerender } = renderHook(
		( { rowId } ) => useRelationTargetStatuses( rowId ),
		{ initialProps: { rowId: 46 } }
	);

	act( () => {
		notifyDocumentArchiveChanged( { action: 'archive' } );
	} );
	await waitFor( () =>
		expect( result.current ).toEqual( { 12: 'private' } )
	);

	rerender( { rowId: 47 } );

	expect( result.current ).toEqual( {} );
} );
