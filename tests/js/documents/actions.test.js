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
import { runAbility } from '../../../src/abilities/runAbility';
import {
	archiveDocument,
	createDocument,
	emptyTrash,
	moveDocument,
	renameDocument,
	restoreDocument,
	restoreDocuments,
	trashDocument,
	unarchiveDocument,
	unarchiveDocuments,
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
		createErrorNotice: jest.fn(),
		createSuccessNotice: jest.fn(),
		...overrides,
	};
}

// The ability answers with `output`; the full record fetched afterwards is
// `post`. Restore from Trash still goes through its route on `apiFetch`.
function mockAbility( output, post ) {
	runAbility.mockResolvedValueOnce( output );
	apiFetch.mockResolvedValueOnce( post );
}

function expectRecordFetched( id ) {
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: `/wp/v2/crtxt_documents/${ id }?context=edit`,
	} );
}

beforeEach( () => {
	apiFetch.mockReset();
} );

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
	it( 'creates through the ability and returns the full record', async () => {
		const ctx = makeCtx();
		const record = { id: 42, slug: 'untitled', parent: 3 };
		mockAbility( { id: 42, parent: 3 }, record );

		const result = await createDocument(
			{ title: 'Notes', parent: 3 },
			ctx
		);

		expect( runAbility ).toHaveBeenCalledWith( 'cortext/create-page', {
			title: 'Notes',
			parent: 3,
		} );
		expectRecordFetched( 42 );
		expect( ctx.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			[ record ],
			undefined,
			false
		);
		expect( result ).toEqual( record );
	} );

	it( 'invalidates the same lists as trash/duplicate', async () => {
		const ctx = makeCtx();
		mockAbility( { id: 9, parent: 0 }, { id: 9 } );

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

	it( 'rejects without invalidating caches when the ability fails', async () => {
		const error = new Error( 'create failed' );
		const ctx = makeCtx();
		runAbility.mockRejectedValue( error );

		await expect( createDocument( {}, ctx ) ).rejects.toBe( error );

		expect( apiFetch ).not.toHaveBeenCalled();
		expect( ctx.invalidateResolution ).not.toHaveBeenCalled();
	} );
} );

describe( 'useCreateDocument', () => {
	beforeEach( () => {
		useDispatch.mockReset();
	} );

	it( 'binds core-data dispatchers and creates through the ability', async () => {
		const receiveEntityRecords = jest.fn();
		const invalidateResolution = jest.fn();
		useDispatch.mockReturnValue( {
			receiveEntityRecords,
			invalidateResolution,
		} );
		mockAbility( { id: 11, parent: 0 }, { id: 11, slug: 'about' } );

		const { result } = renderHook( () => useCreateDocument() );

		let created;
		await act( async () => {
			created = await result.current( { title: 'About' } );
		} );

		expect( useDispatch ).toHaveBeenCalledWith( 'core' );
		expect( runAbility ).toHaveBeenCalledWith( 'cortext/create-page', {
			title: 'About',
		} );
		expect( invalidateResolution ).toHaveBeenCalledTimes(
			afterDocumentTrash.length
		);
		expect( created ).toEqual( { id: 11, slug: 'about' } );
	} );

	it( 'defaults input to an empty object', async () => {
		useDispatch.mockReturnValue( {
			receiveEntityRecords: jest.fn(),
			invalidateResolution: jest.fn(),
		} );
		mockAbility( { id: 5, parent: 0 }, { id: 5 } );

		const { result } = renderHook( () => useCreateDocument() );

		await act( async () => {
			await result.current();
		} );

		expect( runAbility ).toHaveBeenCalledWith( 'cortext/create-page', {} );
	} );
} );

describe( 'renameDocument and moveDocument', () => {
	it( 'renames through the ability and caches the renamed record', async () => {
		const ctx = makeCtx( { touchRecent: jest.fn() } );
		const record = { id: 9, title: 'Roadmap', parent: 2 };
		mockAbility( { id: 9, title: 'Roadmap', parent: 2 }, record );

		await renameDocument( { id: 9, parent: 2 }, 'Roadmap', ctx );

		expect( runAbility ).toHaveBeenCalledWith( 'cortext/rename-document', {
			id: 9,
			title: 'Roadmap',
		} );
		expect( ctx.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			DOCUMENT_POST_TYPE,
			[ record ],
			undefined,
			false
		);
		expect( ctx.touchRecent ).toHaveBeenCalledWith( { id: 9 } );
	} );

	it( 'moves through the ability, refreshes the lists and says so', async () => {
		const ctx = makeCtx();
		const record = { id: 9, parent: 4 };
		mockAbility( { id: 9, parent: 4 }, record );

		const moved = await moveDocument( { id: 9, parent: 0 }, 4, ctx );

		expect( runAbility ).toHaveBeenCalledWith( 'cortext/move-document', {
			id: 9,
			parent: 4,
		} );
		expectRecordFetched( 9 );
		expect( moved ).toEqual( record );
		expectLifecycleInvalidations( ctx );
		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'Document moved.',
			{ id: 'cortext-document-move-success', type: 'snackbar' }
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
			},
			{ throwOnError: true }
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
			{ status: 'draft', cortext_collection: true },
			{ throwOnError: true }
		);
	} );
} );

describe( 'document archive lifecycle', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	it( 'archives through the ability without filtering favorites', async () => {
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
		mockAbility( { archived: [ 9 ] }, post );

		const response = await archiveDocument( record, ctx );

		expect( runAbility ).toHaveBeenCalledWith( 'cortext/archive-document', {
			id: 9,
		} );
		expectRecordFetched( 9 );
		expect( ctx.flushActiveEditor ).toHaveBeenCalledTimes( 1 );
		expect(
			ctx.flushActiveEditor.mock.invocationCallOrder[ 0 ]
		).toBeLessThan( runAbility.mock.invocationCallOrder[ 0 ] );
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

		expect( runAbility ).not.toHaveBeenCalled();
		expect( ctx.invalidateResolution ).not.toHaveBeenCalled();
		expect( ctx.receiveEntityRecords ).not.toHaveBeenCalled();
		expect( ctx.cancelLifecycleFocusIntent ).toHaveBeenCalledWith(
			lifecycleFocusIntent
		);
		expect( ctx.onAfterArchive ).not.toHaveBeenCalled();
		expect( ctx.createErrorNotice ).toHaveBeenCalledWith(
			"Couldn't save changes. Archive was canceled.",
			{
				id: 'cortext-document-archive-save-error',
				type: 'snackbar',
			}
		);
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
		runAbility.mockRejectedValue( error );

		await expect( archiveDocument( { id: 9 }, ctx ) ).rejects.toBe( error );

		expect( ctx.cancelLifecycleFocusIntent ).toHaveBeenCalledWith(
			lifecycleFocusIntent
		);
		expect( ctx.onAfterArchive ).not.toHaveBeenCalled();
	} );

	it( 'invalidates individually cached descendants after a cascade archive', async () => {
		const ctx = makeCtx();
		mockAbility(
			{ archived: [ 9, 10, 11 ] },
			{ id: 9, status: 'crtxt_archived' }
		);

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
		mockAbility(
			{ restored: [ 9 ], published: [ 9 ], status: 'publish' },
			post
		);

		try {
			await unarchiveDocument( { id: 9 }, ctx );
		} finally {
			window.removeEventListener(
				DOCUMENT_ARCHIVE_CHANGED_EVENT,
				onArchiveChanged
			);
		}

		expect( runAbility ).toHaveBeenCalledWith(
			'cortext/unarchive-document',
			{ id: 9 }
		);
		expectLifecycleInvalidations( ctx );
		expect( onArchiveChanged ).toHaveBeenCalledTimes( 1 );
		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'Document restored as published and is public again.',
			expect.objectContaining( {
				id: 'cortext-document-unarchive-success',
				type: 'snackbar',
			} )
		);
		expect( ctx.setFavorites ).not.toHaveBeenCalled();
	} );

	it.each( [
		[
			'a private root with one published descendant',
			{
				restored: [ 9, 10, 11 ],
				published: [ 10 ],
				post: { id: 9, status: 'private' },
			},
			'Document restored as private. 1 nested document is public again.',
		],
		[
			'a private root with several published descendants',
			{
				restored: [ 9, 10, 11 ],
				published: [ 10, 11 ],
				post: { id: 9, status: 'private' },
			},
			'Document restored as private. 2 nested documents are public again.',
		],
		[
			'a published root with published descendants',
			{
				restored: [ 9, 10, 11 ],
				published: [ 9, 10, 11 ],
				post: { id: 9, status: 'publish' },
			},
			'Document restored as published and is public again. 2 nested documents are public again.',
		],
		[
			'a root with no published descendants',
			{
				restored: [ 9, 10 ],
				published: [],
				post: { id: 9, status: 'private' },
			},
			'Document restored as private.',
		],
	] )(
		'says which restored documents are public again for %s',
		async ( _label, { restored, published, post }, message ) => {
			const ctx = makeCtx();
			mockAbility( { restored, published, status: post.status }, post );

			await unarchiveDocument( { id: 9 }, ctx );

			expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
				message,
				expect.objectContaining( {
					id: 'cortext-document-unarchive-success',
					type: 'snackbar',
				} )
			);
		}
	);

	it( 'refreshes Archived when an archived document moves to Trash', async () => {
		const ctx = makeCtx();
		const previous = { id: 9, status: 'trash' };
		const onArchiveChanged = jest.fn();
		window.addEventListener(
			DOCUMENT_ARCHIVE_CHANGED_EVENT,
			onArchiveChanged
		);
		mockAbility( { trashed: [ 9 ] }, previous );

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
			[ { ...previous, cascade_deleted: [] } ]
		);
	} );

	it( 'caches the trashed record and invalidates descendants', async () => {
		const lifecycleFocusIntent = { token: 2 };
		const ctx = makeCtx( {
			captureLifecycleFocusIntent: jest
				.fn()
				.mockReturnValue( lifecycleFocusIntent ),
			onAfterTrash: jest.fn(),
		} );
		const record = { id: 9 };
		mockAbility( { trashed: [ 9, 10 ] }, { id: 9, status: 'trash' } );

		await trashDocument( record, ctx );

		expect( runAbility ).toHaveBeenCalledWith( 'cortext/trash-document', {
			id: 9,
		} );
		expect( ctx.receiveEntityRecords ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			[ { id: 9, status: 'trash', cascade_deleted: [ 10 ] } ]
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

	it( 'saves the open editors before moving a document to Trash', async () => {
		const unlock = jest.fn();
		const ctx = makeCtx( {
			lockEditors: jest.fn().mockReturnValue( unlock ),
			flushActiveEditor: jest.fn().mockResolvedValue( true ),
		} );
		mockAbility( { trashed: [ 9 ] }, { id: 9, status: 'trash' } );

		await expect( trashDocument( { id: 9 }, ctx ) ).resolves.toEqual( {
			id: 9,
			status: 'trash',
			cascade_deleted: [],
		} );

		const lockOrder = ctx.lockEditors.mock.invocationCallOrder[ 0 ];
		const flushOrder = ctx.flushActiveEditor.mock.invocationCallOrder[ 0 ];
		const requestOrder = runAbility.mock.invocationCallOrder[ 0 ];
		const syncOrder =
			ctx.receiveEntityRecords.mock.invocationCallOrder[ 0 ];
		expect( lockOrder ).toBeLessThan( flushOrder );
		expect( flushOrder ).toBeLessThan( requestOrder );
		// The trashed status reaches the store before the editors unlock.
		expect( syncOrder ).toBeLessThan(
			unlock.mock.invocationCallOrder[ 0 ]
		);
		expect( unlock ).toHaveBeenCalledTimes( 1 );
	} );

	it.each( [
		[ 'archive', archiveDocument, { archived: [ 9, 10 ] } ],
		[ 'trash', trashDocument, { trashed: [ 9, 10 ] } ],
	] )(
		'keeps the editors locked during the %s until open cascaded documents reload',
		async ( _name, action, response ) => {
			const unlock = jest.fn();
			let finishReload;
			const ctx = makeCtx( {
				lockEditors: jest.fn().mockReturnValue( unlock ),
				flushActiveEditor: jest.fn().mockResolvedValue( true ),
				waitForOpenDocuments: jest.fn(
					() =>
						new Promise( ( resolve ) => {
							finishReload = resolve;
						} )
				),
			} );
			mockAbility( response, { id: 9 } );

			const result = action( { id: 9 }, ctx );
			await new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

			expect( ctx.waitForOpenDocuments ).toHaveBeenCalledWith(
				expect.arrayContaining( [ 10 ] )
			);
			expect( unlock ).not.toHaveBeenCalled();

			finishReload();
			await result;
			expect( unlock ).toHaveBeenCalledTimes( 1 );
		}
	);

	it( 'cancels Trash when the open editors cannot be saved', async () => {
		const lifecycleFocusIntent = { token: 3 };
		const unlock = jest.fn();
		const ctx = makeCtx( {
			captureLifecycleFocusIntent: jest
				.fn()
				.mockReturnValue( lifecycleFocusIntent ),
			cancelLifecycleFocusIntent: jest.fn(),
			lockEditors: jest.fn().mockReturnValue( unlock ),
			flushActiveEditor: jest.fn().mockResolvedValue( false ),
			onAfterTrash: jest.fn(),
		} );

		await expect( trashDocument( { id: 9 }, ctx ) ).resolves.toBeNull();

		expect( runAbility ).not.toHaveBeenCalled();
		expect( ctx.setFavorites ).not.toHaveBeenCalled();
		expect( ctx.onAfterTrash ).not.toHaveBeenCalled();
		expect( ctx.cancelLifecycleFocusIntent ).toHaveBeenCalledWith(
			lifecycleFocusIntent
		);
		expect( ctx.createErrorNotice ).toHaveBeenCalledWith(
			"Couldn't save changes. Move to Trash was canceled.",
			{
				id: 'cortext-document-trash-save-error',
				type: 'snackbar',
			}
		);
		expect( unlock ).toHaveBeenCalledTimes( 1 );
	} );

	it.each( [
		[ 'archive', archiveDocument ],
		[ 'trash', trashDocument ],
	] )(
		'keeps the editors locked during the %s request and unlocks them when it fails',
		async ( _name, action ) => {
			const unlock = jest.fn();
			const ctx = makeCtx( {
				lockEditors: jest.fn().mockReturnValue( unlock ),
				flushActiveEditor: jest.fn().mockResolvedValue( true ),
			} );
			let rejectRequest;
			runAbility.mockReturnValue(
				new Promise( ( resolve, reject ) => {
					rejectRequest = reject;
				} )
			);

			const result = action( { id: 9 }, ctx );
			await Promise.resolve();
			await Promise.resolve();
			expect( runAbility ).toHaveBeenCalledTimes( 1 );
			expect( unlock ).not.toHaveBeenCalled();

			const error = new Error( 'offline' );
			rejectRequest( error );
			await expect( result ).rejects.toBe( error );
			expect( unlock ).toHaveBeenCalledTimes( 1 );
		}
	);

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
		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'Document restored to Archived.',
			{
				id: 'cortext-document-restore-success',
				type: 'snackbar',
				actions: [ expect.objectContaining( { label: 'Undo' } ) ],
			}
		);
	} );

	it.each( [
		[
			'a private root with a published descendant',
			{
				restored: [ 9, 10 ],
				published: [ 10 ],
				post: { id: 9, status: 'private' },
			},
			'Document restored as private. 1 nested document is public again.',
		],
		[
			'a published root with published descendants',
			{
				restored: [ 9, 10, 11 ],
				published: [ 9, 10, 11 ],
				post: { id: 9, status: 'publish' },
			},
			'Document restored as published and is public again. 2 nested documents are public again.',
		],
		[
			'a root with no published descendants',
			{
				restored: [ 9, 10 ],
				published: [],
				post: { id: 9, status: 'draft' },
			},
			'Document restored as draft.',
		],
	] )(
		'says which documents restored from Trash are public again for %s',
		async ( _label, response, message ) => {
			const ctx = makeCtx();
			apiFetch.mockResolvedValue( response );

			await restoreDocument( { id: 9 }, ctx );

			expect( ctx.createSuccessNotice ).toHaveBeenCalledWith( message, {
				id: 'cortext-document-restore-success',
				type: 'snackbar',
				actions: [ expect.objectContaining( { label: 'Undo' } ) ],
			} );
		}
	);

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

describe( 'Trash snackbars', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	function undoFrom( notice ) {
		const [ , options ] = notice.mock.calls.at( -1 );
		return options.actions.find( ( action ) => action.label === 'Undo' );
	}

	it( 'says what moved to Trash and restores it on Undo', async () => {
		const ctx = makeCtx();
		mockAbility( { trashed: [ 9, 10, 11 ] }, { id: 9, status: 'trash' } );

		await trashDocument( { id: 9 }, ctx );

		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'Document and 2 nested documents moved to Trash.',
			expect.objectContaining( {
				id: 'cortext-document-trash-success',
				type: 'snackbar',
			} )
		);

		apiFetch.mockResolvedValueOnce( {
			restored: [ 9, 10, 11 ],
			post: { id: 9, status: 'private' },
		} );
		await act( () => undoFrom( ctx.createSuccessNotice ).onClick() );

		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/cortext/v1/documents/9/restore',
			method: 'POST',
		} );
	} );

	it( 'moves a restored document back to Trash on Undo', async () => {
		const ctx = makeCtx();
		apiFetch.mockResolvedValueOnce( {
			restored: [ 9 ],
			post: { id: 9, status: 'draft' },
		} );

		await restoreDocument( { id: 9 }, ctx );

		mockAbility( { trashed: [ 9 ] }, { id: 9, status: 'trash' } );
		await act( () => undoFrom( ctx.createSuccessNotice ).onClick() );

		expect( runAbility ).toHaveBeenLastCalledWith(
			'cortext/trash-document',
			{
				id: 9,
			}
		);
	} );

	it( 'reports a failed Undo in the same snackbar slot', async () => {
		const ctx = makeCtx();
		apiFetch.mockResolvedValueOnce( {
			restored: [ 9 ],
			post: { id: 9, status: 'draft' },
		} );
		await restoreDocument( { id: 9 }, ctx );

		runAbility.mockRejectedValueOnce( new Error( 'Nope' ) );
		await act( () => undoFrom( ctx.createSuccessNotice ).onClick() );

		expect( ctx.createErrorNotice ).toHaveBeenCalledWith( 'Nope', {
			id: 'cortext-document-restore-success',
			type: 'snackbar',
		} );
	} );

	it( 'restores documents trashed together and refreshes the lists once', async () => {
		const ctx = makeCtx();
		const onTrashChanged = jest.fn();
		window.addEventListener( DOCUMENT_TRASH_CHANGED_EVENT, onTrashChanged );
		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve( {
				restored: [],
				post: { id: Number( path.match( /\d+/ )[ 0 ] ) },
			} )
		);

		try {
			await restoreDocuments( [ { id: 1 }, { id: 2 }, { id: 3 } ], ctx );
		} finally {
			window.removeEventListener(
				DOCUMENT_TRASH_CHANGED_EVENT,
				onTrashChanged
			);
		}

		expect( apiFetch ).toHaveBeenCalledTimes( 3 );
		expect( onTrashChanged ).toHaveBeenCalledTimes( 1 );
		expectLifecycleInvalidations( ctx );
		expect( ctx.createSuccessNotice ).toHaveBeenCalledTimes( 1 );
		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'3 documents restored.',
			{ id: 'cortext-document-restore-success', type: 'snackbar' }
		);
	} );

	it( 'restores at most four documents at a time', async () => {
		const ctx = makeCtx();
		let inFlight = 0;
		let maxInFlight = 0;
		apiFetch.mockImplementation( async () => {
			inFlight++;
			maxInFlight = Math.max( maxInFlight, inFlight );
			await Promise.resolve();
			inFlight--;
			return { restored: [], post: null };
		} );

		await restoreDocuments(
			Array.from( { length: 10 }, ( _, index ) => ( { id: index + 1 } ) ),
			ctx
		);

		expect( apiFetch ).toHaveBeenCalledTimes( 10 );
		expect( maxInFlight ).toBe( 4 );
	} );

	it( 'says how many documents could not be restored', async () => {
		const ctx = makeCtx();
		apiFetch
			.mockResolvedValueOnce( { restored: [ 1 ], post: { id: 1 } } )
			.mockRejectedValueOnce( new Error( 'Nope' ) );

		await restoreDocuments( [ { id: 1 }, { id: 2 } ], ctx );

		expect( ctx.createSuccessNotice ).not.toHaveBeenCalled();
		expect( ctx.createErrorNotice ).toHaveBeenCalledWith(
			"1 of 2 documents couldn't be restored.",
			{ id: 'cortext-document-restore-success', type: 'snackbar' }
		);
	} );

	it( 'empties Trash and refreshes the lists', async () => {
		const ctx = makeCtx();
		const onTrashChanged = jest.fn();
		window.addEventListener( DOCUMENT_TRASH_CHANGED_EVENT, onTrashChanged );
		apiFetch.mockResolvedValueOnce( { deleted: [ 1, 2 ] } );

		let response;
		try {
			response = await emptyTrash( ctx );
		} finally {
			window.removeEventListener(
				DOCUMENT_TRASH_CHANGED_EVENT,
				onTrashChanged
			);
		}

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/empty-trash',
			method: 'POST',
		} );
		expect( response ).toEqual( { deleted: [ 1, 2 ] } );
		expect( onTrashChanged ).toHaveBeenCalledTimes( 1 );
		expectLifecycleInvalidations( ctx );
	} );
} );

describe( 'Archive snackbars', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	function undoFrom( notice ) {
		const [ , options ] = notice.mock.calls.at( -1 );
		return options.actions.find( ( action ) => action.label === 'Undo' );
	}

	it( 'says what was archived and unarchives it on Undo', async () => {
		const ctx = makeCtx();
		mockAbility(
			{ archived: [ 9, 10, 11 ] },
			{ id: 9, status: 'crtxt_archived' }
		);

		await archiveDocument( { id: 9 }, ctx );

		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'Document and 2 nested documents archived.',
			expect.objectContaining( {
				id: 'cortext-document-archive-success',
				type: 'snackbar',
			} )
		);

		mockAbility(
			{ restored: [ 9, 10, 11 ], published: [], status: 'draft' },
			{ id: 9, status: 'draft' }
		);
		await act( () => undoFrom( ctx.createSuccessNotice ).onClick() );

		expect( runAbility ).toHaveBeenLastCalledWith(
			'cortext/unarchive-document',
			{ id: 9 }
		);
	} );

	it( 'archives an unarchived document again on Undo', async () => {
		const ctx = makeCtx();
		mockAbility(
			{ restored: [ 9 ], published: [], status: 'draft' },
			{ id: 9, status: 'draft' }
		);

		await unarchiveDocument( { id: 9 }, ctx );

		mockAbility( { archived: [ 9 ] }, { id: 9, status: 'crtxt_archived' } );
		await act( () => undoFrom( ctx.createSuccessNotice ).onClick() );

		expect( runAbility ).toHaveBeenLastCalledWith(
			'cortext/archive-document',
			{ id: 9 }
		);
		expect( ctx.createSuccessNotice ).toHaveBeenLastCalledWith(
			'Document archived.',
			expect.objectContaining( {
				id: 'cortext-document-archive-success',
			} )
		);
	} );

	it( 'unarchives documents archived together and refreshes Archived once', async () => {
		const ctx = makeCtx();
		const onArchiveChanged = jest.fn();
		window.addEventListener(
			DOCUMENT_ARCHIVE_CHANGED_EVENT,
			onArchiveChanged
		);
		apiFetch.mockImplementation( ( { path } ) =>
			Promise.resolve( {
				restored: [],
				post: { id: Number( path.match( /\d+/ )[ 0 ] ) },
			} )
		);

		try {
			await unarchiveDocuments( [ { id: 1 }, { id: 2 } ], ctx );
		} finally {
			window.removeEventListener(
				DOCUMENT_ARCHIVE_CHANGED_EVENT,
				onArchiveChanged
			);
		}

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/1/unarchive',
			method: 'POST',
		} );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( onArchiveChanged ).toHaveBeenCalledTimes( 1 );
		expectLifecycleInvalidations( ctx );
		expect( ctx.createSuccessNotice ).toHaveBeenCalledWith(
			'2 documents unarchived.',
			{ id: 'cortext-document-restore-success', type: 'snackbar' }
		);
	} );

	it( 'says how many documents could not be unarchived', async () => {
		const ctx = makeCtx();
		apiFetch
			.mockResolvedValueOnce( { restored: [ 1 ], post: { id: 1 } } )
			.mockRejectedValueOnce( new Error( 'Nope' ) );

		await unarchiveDocuments( [ { id: 1 }, { id: 2 } ], ctx );

		expect( ctx.createSuccessNotice ).not.toHaveBeenCalled();
		expect( ctx.createErrorNotice ).toHaveBeenCalledWith(
			"1 of 2 documents couldn't be unarchived.",
			{ id: 'cortext-document-restore-success', type: 'snackbar' }
		);
	} );
} );
