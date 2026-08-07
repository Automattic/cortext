/**
 * Tests for `src/documents/actions.js`.
 *
 * `createDocument` is a pure persist + invalidate action. Post-create UX
 * (navigation, auto-rename, picker selection) is the caller's responsibility.
 * `useCreateDocument` is the standalone hook that wires the core-data
 * dispatchers and binds them to `createDocument`.
 */

import { renderHook, act } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => {
	const useDispatch = jest.fn();
	return { __esModule: true, useDispatch };
} );

import { useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import {
	archiveDocument,
	createDocument,
	restoreDocument,
	trashDocument,
	unarchiveDocument,
	useCreateCollectionDocument,
	useCreateDocument,
} from '../../../src/documents/actions';
import { DOCUMENT_POST_TYPE } from '../../../src/collections';
import { afterDocumentTrash } from '../../../src/documents/invalidation';
import {
	POST_TYPE,
	PUBLISHED_DOCUMENTS_QUERY,
} from '../../../src/components/page-queries';
import { DOCUMENT_ARCHIVE_CHANGED_EVENT } from '../../../src/hooks/documentArchiveInvalidation';
import { DOCUMENT_TRASH_CHANGED_EVENT } from '../../../src/hooks/documentTrashInvalidation';

function makeCtx( overrides = {} ) {
	return {
		saveEntityRecord: jest.fn(),
		invalidateResolution: jest.fn(),
		receiveEntityRecords: jest.fn(),
		setFavorites: jest.fn().mockResolvedValue( undefined ),
		createSuccessNotice: jest.fn(),
		...overrides,
	};
}

function expectLifecycleInvalidations( ctx ) {
	const lifecycleCalls = ctx.invalidateResolution.mock.calls.filter(
		( [ selector ] ) => selector !== 'getEntityRecord'
	);
	expect( lifecycleCalls ).toHaveLength( afterDocumentTrash.length );
	afterDocumentTrash.forEach( ( [ selector, args ], index ) => {
		expect( lifecycleCalls[ index ] ).toEqual( [ selector, args ] );
	} );
}

describe( 'createDocument', () => {
	it( 'persists with `status: draft` by default and returns the created record', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( {
			id: 42,
			slug: 'untitled',
		} );

		const result = await createDocument( {}, ctx );

		expect( ctx.saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft' }
		);
		expect( result ).toEqual( { id: 42, slug: 'untitled' } );
	} );

	it( 'merges the caller payload over the default status', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( { id: 7 } );

		await createDocument(
			{ title: 'Untitled', status: 'private', parent: 3 },
			ctx
		);

		expect( ctx.saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ title: 'Untitled', status: 'private', parent: 3 }
		);
	} );

	it( 'invalidates the same lists as trash/duplicate', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( { id: 9 } );

		await createDocument( {}, ctx );

		expect( ctx.invalidateResolution ).toHaveBeenCalledTimes(
			afterDocumentTrash.length
		);
		afterDocumentTrash.forEach( ( [ selector, args ], index ) => {
			expect( ctx.invalidateResolution ).toHaveBeenNthCalledWith(
				index + 1,
				selector,
				args
			);
		} );
	} );

	it( 'skips invalidation when no id comes back', async () => {
		const ctx = makeCtx();
		ctx.saveEntityRecord.mockResolvedValue( null );

		const result = await createDocument( {}, ctx );

		expect( result ).toBeNull();
		expect( ctx.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );

describe( 'useCreateDocument', () => {
	beforeEach( () => {
		useDispatch.mockReset();
	} );

	it( 'binds core-data dispatchers and calls saveEntityRecord on invocation', async () => {
		const saveEntityRecord = jest
			.fn()
			.mockResolvedValue( { id: 11, slug: 'about' } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateDocument() );

		let created;
		await act( async () => {
			created = await result.current( { title: 'About' } );
		} );

		expect( useDispatch ).toHaveBeenCalledWith( 'core' );
		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft', title: 'About' }
		);
		expect( invalidateResolution ).toHaveBeenCalledTimes(
			afterDocumentTrash.length
		);
		expect( created ).toEqual( { id: 11, slug: 'about' } );
	} );

	it( 'defaults input to an empty object', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 5 } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateDocument() );

		await act( async () => {
			await result.current();
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft' }
		);
	} );
} );

describe( 'useCreateCollectionDocument', () => {
	beforeEach( () => {
		useDispatch.mockReset();
	} );

	it( 'adds cortext_collection to the caller payload', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 21 } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateCollectionDocument() );

		await act( async () => {
			await result.current( { title: 'Tasks', parent: 3 } );
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{
				status: 'draft',
				title: 'Tasks',
				parent: 3,
				cortext_collection: true,
			}
		);
	} );

	it( 'creates a draft with only the collection flag by default', async () => {
		const saveEntityRecord = jest.fn().mockResolvedValue( { id: 22 } );
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			saveEntityRecord,
			invalidateResolution,
		} );

		const { result } = renderHook( () => useCreateCollectionDocument() );

		await act( async () => {
			await result.current();
		} );

		expect( saveEntityRecord ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			{ status: 'draft', cortext_collection: true }
		);
	} );
} );

describe( 'document archive lifecycle', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'archives through the dedicated endpoint without filtering favorites', async () => {
		const lifecycleFocusIntent = { token: 1 };
		const ctx = makeCtx( {
			captureLifecycleFocusIntent: jest
				.fn()
				.mockReturnValue( lifecycleFocusIntent ),
			flushActiveEditor: jest.fn().mockResolvedValue( true ),
			onAfterArchive: jest.fn(),
		} );
		const record = { id: 9 };
		const post = { id: 9, status: 'crtxt_archived' };
		apiFetch.mockResolvedValue( { archived: [ 9 ], post } );

		const response = await archiveDocument( record, ctx );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/9/archive',
			method: 'POST',
		} );
		expect( ctx.flushActiveEditor ).toHaveBeenCalledTimes( 1 );
		expect(
			ctx.flushActiveEditor.mock.invocationCallOrder[ 0 ]
		).toBeLessThan( apiFetch.mock.invocationCallOrder[ 0 ] );
		expect( ctx.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			[ post ]
		);
		expectLifecycleInvalidations( ctx );
		expect( ctx.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', POST_TYPE, PUBLISHED_DOCUMENTS_QUERY ]
		);
		expect( ctx.setFavorites ).not.toHaveBeenCalled();
		expect( ctx.captureLifecycleFocusIntent ).toHaveBeenCalledWith(
			record
		);
		expect( ctx.onAfterArchive ).toHaveBeenCalledWith( {
			record,
			response,
			lifecycleFocusIntent,
		} );
		expect( response ).toEqual( { archived: [ 9 ], post } );
	} );

	it( 'aborts archive when the active editor cannot be saved', async () => {
		const lifecycleFocusIntent = { token: 1 };
		const ctx = makeCtx( {
			captureLifecycleFocusIntent: jest
				.fn()
				.mockReturnValue( lifecycleFocusIntent ),
			cancelLifecycleFocusIntent: jest.fn(),
			flushActiveEditor: jest.fn().mockResolvedValue( false ),
			onAfterArchive: jest.fn(),
		} );

		await expect( archiveDocument( { id: 9 }, ctx ) ).resolves.toBeNull();

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( ctx.invalidateResolution ).not.toHaveBeenCalled();
		expect( ctx.receiveEntityRecords ).not.toHaveBeenCalled();
		expect( ctx.cancelLifecycleFocusIntent ).toHaveBeenCalledWith(
			lifecycleFocusIntent
		);
		expect( ctx.onAfterArchive ).not.toHaveBeenCalled();
	} );

	it( 'cancels a captured focus intent when archiving fails', async () => {
		const lifecycleFocusIntent = { token: 1 };
		const error = new Error( 'Archive failed' );
		const ctx = makeCtx( {
			captureLifecycleFocusIntent: jest
				.fn()
				.mockReturnValue( lifecycleFocusIntent ),
			cancelLifecycleFocusIntent: jest.fn(),
			onAfterArchive: jest.fn(),
		} );
		apiFetch.mockRejectedValue( error );

		await expect( archiveDocument( { id: 9 }, ctx ) ).rejects.toBe( error );

		expect( ctx.cancelLifecycleFocusIntent ).toHaveBeenCalledWith(
			lifecycleFocusIntent
		);
		expect( ctx.onAfterArchive ).not.toHaveBeenCalled();
	} );

	it( 'invalidates individually cached descendants after a cascade archive', async () => {
		const ctx = makeCtx();
		apiFetch.mockResolvedValue( {
			archived: [ 9, 10, 11 ],
			post: { id: 9, status: 'crtxt_archived' },
		} );

		await archiveDocument( { id: 9 }, ctx );

		expect( ctx.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_document', 10 ]
		);
		expect( ctx.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_document', 11 ]
		);
	} );

	it( 'unarchives, invalidates lifecycle lists, and names the restored status', async () => {
		const ctx = makeCtx();
		const post = { id: 9, status: 'publish' };
		const onArchiveChanged = jest.fn();
		window.addEventListener(
			DOCUMENT_ARCHIVE_CHANGED_EVENT,
			onArchiveChanged
		);
		apiFetch.mockResolvedValue( { restored: [ 9 ], post } );

		try {
			await unarchiveDocument( { id: 9 }, ctx );
		} finally {
			window.removeEventListener(
				DOCUMENT_ARCHIVE_CHANGED_EVENT,
				onArchiveChanged
			);
		}

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/9/unarchive',
			method: 'POST',
		} );
		expectLifecycleInvalidations( ctx );
		expect( onArchiveChanged ).toHaveBeenCalledTimes( 1 );
		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'Document restored as published and is public again.',
			{
				id: 'cortext-document-unarchive-success',
				type: 'snackbar',
			}
		);
		expect( ctx.setFavorites ).not.toHaveBeenCalled();
	} );

	it( 'refreshes Archived when an archived document moves to Trash', async () => {
		const ctx = makeCtx();
		const previous = { id: 9, status: 'trash' };
		const onArchiveChanged = jest.fn();
		window.addEventListener(
			DOCUMENT_ARCHIVE_CHANGED_EVENT,
			onArchiveChanged
		);
		apiFetch.mockResolvedValue( {
			previous,
		} );

		try {
			await trashDocument( { id: 9, status: 'crtxt_archived' }, ctx );
		} finally {
			window.removeEventListener(
				DOCUMENT_ARCHIVE_CHANGED_EVENT,
				onArchiveChanged
			);
		}

		expect( onArchiveChanged ).toHaveBeenCalledTimes( 1 );
		expect( ctx.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			[ previous ]
		);
	} );

	it( 'syncs a real top-level soft DELETE response and invalidates descendants', async () => {
		const lifecycleFocusIntent = { token: 2 };
		const ctx = makeCtx( {
			captureLifecycleFocusIntent: jest
				.fn()
				.mockReturnValue( lifecycleFocusIntent ),
			onAfterTrash: jest.fn(),
		} );
		const record = { id: 9 };
		const deleted = {
			id: 9,
			status: 'trash',
			cascade_deleted: [ 10 ],
		};
		apiFetch.mockResolvedValue( deleted );

		await trashDocument( record, ctx );

		expect( ctx.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			[ deleted ]
		);
		expect( ctx.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_document', 10 ]
		);
		expect( ctx.invalidateResolution ).not.toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_document', 9 ]
		);
		expect( ctx.onAfterTrash ).toHaveBeenCalledWith( {
			record,
			lifecycleFocusIntent,
		} );
	} );

	it( 'refreshes Trash and Archived when restoring a trashed archived document', async () => {
		const ctx = makeCtx();
		const onArchiveChanged = jest.fn();
		const onTrashChanged = jest.fn();
		window.addEventListener(
			DOCUMENT_ARCHIVE_CHANGED_EVENT,
			onArchiveChanged
		);
		window.addEventListener( DOCUMENT_TRASH_CHANGED_EVENT, onTrashChanged );
		apiFetch.mockResolvedValue( {
			restored: [ 9 ],
			post: { id: 9, status: 'crtxt_archived' },
		} );

		try {
			await restoreDocument( { id: 9 }, ctx );
		} finally {
			window.removeEventListener(
				DOCUMENT_ARCHIVE_CHANGED_EVENT,
				onArchiveChanged
			);
			window.removeEventListener(
				DOCUMENT_TRASH_CHANGED_EVENT,
				onTrashChanged
			);
		}

		expect( onTrashChanged ).toHaveBeenCalledTimes( 1 );
		expect( onArchiveChanged ).toHaveBeenCalledTimes( 1 );
		expect( ctx.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			[ { id: 9, status: 'crtxt_archived' } ]
		);
	} );

	it( 'invalidates every cached descendant restored from Trash', async () => {
		const ctx = makeCtx();
		apiFetch.mockResolvedValue( {
			restored: [ 9, 10, 11 ],
			post: { id: 9, status: 'private' },
		} );

		await restoreDocument( { id: 9 }, ctx );

		expect( ctx.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_document', 10 ]
		);
		expect( ctx.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecord',
			[ 'postType', 'crtxt_document', 11 ]
		);
	} );
} );
