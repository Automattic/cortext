import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useCallback } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';

import { DOCUMENT_POST_TYPE } from '../collections';
import allSettledWithConcurrency from '../components/allSettledWithConcurrency';
import { computeDocumentUri } from '../router/useResolveEntity';
import { notifyDocumentArchiveChanged } from '../hooks/documentArchiveInvalidation';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';
import { notifySidebarTreeChanged } from '../hooks/sidebarTreeInvalidation';
import { cascadeFavorites } from './favorites';
import { afterDocumentTrash, applyInvalidationPack } from './invalidation';
import { duplicateDocumentRecord } from './mutations';

function collectCascadeIds( record, cascade ) {
	const ids = new Set( [ Number( record.id ) ] );
	if ( Array.isArray( cascade ) ) {
		cascade.forEach( ( id ) => ids.add( Number( id ) ) );
	}
	return ids;
}

function lifecyclePostFromResponse( response ) {
	if ( response?.post?.id ) {
		return response.post;
	}
	if ( response?.previous?.id ) {
		return response.previous;
	}
	return response?.id ? response : null;
}

function receiveLifecyclePost( response, ctx ) {
	const post = lifecyclePostFromResponse( response );
	if ( post?.id ) {
		ctx.receiveEntityRecords?.( 'postType', DOCUMENT_POST_TYPE, [ post ] );
	}
	return post;
}

export function syncLifecycleEntityRecords( response, ctx, cascadeKey ) {
	const post = receiveLifecyclePost( response, ctx );
	const rootId = Number( post?.id ?? 0 );
	const cascadeIds = Array.isArray( response?.[ cascadeKey ] )
		? response[ cascadeKey ]
		: [];
	cascadeIds.forEach( ( id ) => {
		const documentId = Number( id );
		if ( ! documentId || documentId === rootId ) {
			return;
		}
		ctx.invalidateResolution?.( 'getEntityRecord', [
			'postType',
			DOCUMENT_POST_TYPE,
			documentId,
		] );
	} );
}

// Syncs the lifecycle response and waits for the open editors among the
// cascaded documents to reload, so none of them unlocks on its old status.
async function syncLifecycleRecordsForEditors( response, ctx, cascadeKey ) {
	syncLifecycleEntityRecords( response, ctx, cascadeKey );
	const cascadeIds = response?.[ cascadeKey ];
	if ( Array.isArray( cascadeIds ) && cascadeIds.length > 0 ) {
		await ctx.waitForOpenDocuments?.( cascadeIds );
	}
}

function invalidateDocumentLifecycle( ctx ) {
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged();
	notifyCollectionRowsChanged();
}

export function restoredDocumentStatusMessage(
	status,
	publicDescendantCount = 0
) {
	const message = restoredRootStatusMessage( status );
	if ( publicDescendantCount < 1 ) {
		return message;
	}

	return `${ message } ${ sprintf(
		/* translators: %d: number of nested documents that are public again */
		_n(
			'%d nested document is public again.',
			'%d nested documents are public again.',
			publicDescendantCount,
			'cortext'
		),
		publicDescendantCount
	) }`;
}

function restoredRootStatusMessage( status ) {
	if ( status === 'crtxt_archived' ) {
		return __( 'Document restored to Archived.', 'cortext' );
	}

	if ( status === 'publish' ) {
		return __(
			'Document restored as published and is public again.',
			'cortext'
		);
	}

	let label;
	switch ( status ) {
		case 'private':
			label = __( 'private', 'cortext' );
			break;
		case 'draft':
			label = __( 'draft', 'cortext' );
			break;
		default:
			label = status || __( 'its previous status', 'cortext' );
	}

	return sprintf(
		/* translators: %s: restored document status, such as published or private */
		__( 'Document restored as %s.', 'cortext' ),
		label
	);
}

function notifyRestored( response, ctx, noticeId, actions ) {
	const publicDescendantCount = ( response?.published ?? [] ).filter(
		( id ) => id !== response?.post?.id
	).length;
	ctx.createSuccessNotice?.(
		restoredDocumentStatusMessage(
			response?.post?.status,
			publicDescendantCount
		),
		{
			id: noticeId,
			type: 'snackbar',
			...( actions ? { actions } : {} ),
		}
	);
}

// Snackbar action that reverses a lifecycle change. A failed undo reports
// itself in the same snackbar slot, since the snackbar that offered it is gone.
export function undoAction( ctx, run, noticeId ) {
	return [
		{
			label: __( 'Undo', 'cortext' ),
			onClick: () =>
				run().catch( ( error ) =>
					ctx.createErrorNotice?.(
						error?.message ?? __( "Couldn't undo.", 'cortext' ),
						{ id: noticeId, type: 'snackbar' }
					)
				),
		},
	];
}

// How many requests run at once when undoing a bulk trash or archive,
// matching the cap the bulk actions themselves use.
const RESTORE_CONCURRENCY = 4;

// Brings back documents trashed or archived together, such as a bulk row
// selection. The lists refresh and the snackbar reports once for the whole
// batch, and a row that fails does not hide the ones that came back.
async function restoreDocumentBatch(
	records,
	ctx,
	{ endpoint, failureMessage, successMessage }
) {
	const results = await allSettledWithConcurrency(
		records,
		RESTORE_CONCURRENCY,
		( record ) =>
			apiFetch( {
				path: `/cortext/v1/documents/${ record.id }/${ endpoint }`,
				method: 'POST',
			} )
	);
	results.forEach( ( result ) => {
		if ( result.status === 'fulfilled' ) {
			syncLifecycleEntityRecords( result.value, ctx, 'restored' );
		}
	} );
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged();
	notifyDocumentTrashChanged();
	notifyDocumentArchiveChanged( { action: endpoint } );
	notifyCollectionRowsChanged();

	const failed = results.filter(
		( result ) => result.status === 'rejected'
	).length;
	if ( failed > 0 ) {
		ctx.createErrorNotice?.( failureMessage( failed, records.length ), {
			id: 'cortext-document-restore-success',
			type: 'snackbar',
		} );
		return;
	}
	ctx.createSuccessNotice?.( successMessage( records.length ), {
		id: 'cortext-document-restore-success',
		type: 'snackbar',
	} );
}

// Restores documents trashed together.
export function restoreDocuments( records, ctx ) {
	return restoreDocumentBatch( records, ctx, {
		endpoint: 'restore',
		failureMessage: ( failed, total ) =>
			sprintf(
				/* translators: 1: number of documents that could not be restored, 2: number of documents in the batch */
				__( "%1$d of %2$d documents couldn't be restored.", 'cortext' ),
				failed,
				total
			),
		successMessage: ( count ) =>
			sprintf(
				/* translators: %d: number of documents restored from Trash */
				_n(
					'%d document restored.',
					'%d documents restored.',
					count,
					'cortext'
				),
				count
			),
	} );
}

// Unarchives documents archived together.
export function unarchiveDocuments( records, ctx ) {
	return restoreDocumentBatch( records, ctx, {
		endpoint: 'unarchive',
		failureMessage: ( failed, total ) =>
			sprintf(
				/* translators: 1: number of documents that could not be unarchived, 2: number of documents in the batch */
				__(
					"%1$d of %2$d documents couldn't be unarchived.",
					'cortext'
				),
				failed,
				total
			),
		successMessage: ( count ) =>
			sprintf(
				/* translators: %d: number of documents restored from Archived */
				_n(
					'%d document unarchived.',
					'%d documents unarchived.',
					count,
					'cortext'
				),
				count
			),
	} );
}

export function movedToTrashMessage( nestedCount = 0 ) {
	if ( nestedCount < 1 ) {
		return __( 'Document moved to Trash.', 'cortext' );
	}
	return sprintf(
		/* translators: %d: number of nested documents moved to Trash along with the document */
		_n(
			'Document and %d nested document moved to Trash.',
			'Document and %d nested documents moved to Trash.',
			nestedCount,
			'cortext'
		),
		nestedCount
	);
}

export function archivedMessage( nestedCount = 0 ) {
	if ( nestedCount < 1 ) {
		return __( 'Document archived.', 'cortext' );
	}
	return sprintf(
		/* translators: %d: number of nested documents archived along with the document */
		_n(
			'Document and %d nested document archived.',
			'Document and %d nested documents archived.',
			nestedCount,
			'cortext'
		),
		nestedCount
	);
}

export function archiveSaveFailureMessage() {
	return __( "Couldn't save changes. Archive was canceled.", 'cortext' );
}

export function trashSaveFailureMessage() {
	return __(
		"Couldn't save changes. Move to Trash was canceled.",
		'cortext'
	);
}

// Saves the open editors, then runs `request` while they stay read-only, so
// nothing typed during an archive or trash is lost when the status changes.
// Resolves false without running `request` when the save fails.
export async function runWithEditorsLocked( ctx, request ) {
	const unlock = ctx.lockEditors?.();
	try {
		if ( ( await ctx.flushActiveEditor?.() ) === false ) {
			return false;
		}
		return await request();
	} finally {
		unlock?.();
	}
}

// Pure create: saves the new document and refreshes the lists. Post-create
// UX (navigation, auto-rename, selection in a block picker) belongs to the
// caller; this function only owns the persistence and cache invalidation.
//
// `input` is a partial post-data object (`{title, parent, status, ...}`).
// Defaults to `status: 'draft'`.
export async function createDocument( input, ctx ) {
	const payload = { status: 'draft', ...input };
	const created = await ctx.saveEntityRecord(
		'postType',
		DOCUMENT_POST_TYPE,
		payload,
		{ throwOnError: true }
	);
	if ( created?.id ) {
		applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
		notifySidebarTreeChanged( {
			parentId: Number( created.parent ?? payload.parent ?? 0 ),
		} );
	}
	return created;
}

// Standalone hook for `createDocument`. Any component (sidebar, blocks, etc.)
// can call this without going through `DocumentsProvider`; the hook wires
// the core-data dispatchers itself.
export function useCreateDocument() {
	const { saveEntityRecord, invalidateResolution } = useDispatch( 'core' );
	return useCallback(
		( input = {} ) =>
			createDocument( input, { saveEntityRecord, invalidateResolution } ),
		[ saveEntityRecord, invalidateResolution ]
	);
}

// Create a collection document. The REST layer reads `cortext_collection` while
// saving, mirrors the trait term, and creates the owner data view. The flag is
// not stored on the post.
export function useCreateCollectionDocument() {
	const create = useCreateDocument();
	return useCallback(
		( input = {} ) => create( { ...input, cortext_collection: true } ),
		[ create ]
	);
}

// First rename of a draft promotes status to private so core regenerates
// `post_name` from the new title via `wp_unique_post_slug(sanitize_title())`.
export async function renameDocument( record, title, ctx ) {
	const payload = { id: record.id, title };
	if ( record.status === 'draft' ) {
		payload.status = 'private';
	}
	const updated = await ctx.saveEntityRecord(
		'postType',
		DOCUMENT_POST_TYPE,
		payload
	);
	notifySidebarTreeChanged( {
		parentId: Number( updated?.parent ?? record.parent ?? 0 ),
	} );
	await ctx.touchRecent( { id: record.id } );
}

export async function duplicateDocument( record, ctx ) {
	const created = await duplicateDocumentRecord(
		record,
		ctx.receiveEntityRecords
	);
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged( {
		parentId: Number( created?.parent ?? record.parent ?? 0 ),
	} );
	const skipped = Array.isArray( created?.skipped_fields )
		? created.skipped_fields
		: [];
	if ( skipped.length > 0 ) {
		ctx.onDuplicateNotice?.(
			sprintf(
				/* translators: %d: number of fields skipped while duplicating a collection. */
				_n(
					"%d field wasn't copied to the new collection. Add it again if you need it.",
					"%d fields weren't copied to the new collection. Add them again if you need them.",
					skipped.length,
					'cortext'
				),
				skipped.length
			)
		);
	} else {
		ctx.onDuplicateNotice?.( null );
	}
	if ( created?.id ) {
		ctx.onAutoRename?.( { id: created.id } );
		ctx.navigate?.( {
			to: '/$',
			params: { _splat: computeDocumentUri( created ) },
		} );
	}
	return created;
}

// Saves and locks the open editors, runs `request`, and syncs its response.
// Resolves the response, or null after telling the user when the save fails.
async function runDocumentLifecycle(
	record,
	ctx,
	{ request, cascadeKey, saveFailureMessage, noticeId }
) {
	const lifecycleFocusIntent =
		ctx.captureLifecycleFocusIntent?.( record ) ?? null;
	try {
		const response = await runWithEditorsLocked( ctx, async () => {
			const result = await request();
			await syncLifecycleRecordsForEditors( result, ctx, cascadeKey );
			return result;
		} );
		if ( response === false ) {
			ctx.cancelLifecycleFocusIntent?.( lifecycleFocusIntent );
			ctx.createErrorNotice?.( saveFailureMessage, {
				id: noticeId,
				type: 'snackbar',
			} );
			return null;
		}
		return { response, lifecycleFocusIntent };
	} catch ( error ) {
		ctx.cancelLifecycleFocusIntent?.( lifecycleFocusIntent );
		throw error;
	}
}

// Soft-delete: server trashes descendants. Avoid `deleteEntityRecord` so
// core-data does not drop the open record before the editor finishes its
// block selection writes.
export async function trashDocument( record, ctx ) {
	const result = await runDocumentLifecycle( record, ctx, {
		request: () =>
			apiFetch( {
				path: `/wp/v2/crtxt_documents/${ record.id }`,
				method: 'DELETE',
			} ),
		cascadeKey: 'cascade_deleted',
		saveFailureMessage: trashSaveFailureMessage(),
		noticeId: 'cortext-document-trash-save-error',
	} );
	if ( ! result ) {
		return null;
	}
	const { response: deleted, lifecycleFocusIntent } = result;
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged();
	notifyDocumentTrashChanged();
	notifyDocumentArchiveChanged( { action: 'trash' } );
	await cascadeFavorites(
		ctx,
		collectCascadeIds( record, deleted?.cascade_deleted ),
		__(
			"Document moved to Trash, but Favorites couldn't be updated.",
			'cortext'
		)
	);
	ctx.onAfterTrash?.( { record, lifecycleFocusIntent } );
	ctx.createSuccessNotice?.(
		movedToTrashMessage( deleted?.cascade_deleted?.length ?? 0 ),
		{
			id: 'cortext-document-trash-success',
			type: 'snackbar',
			actions: undoAction(
				ctx,
				() => restoreDocument( record, ctx ),
				'cortext-document-trash-success'
			),
		}
	);
	return deleted;
}

export async function restoreDocument( record, ctx ) {
	const response = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/restore`,
		method: 'POST',
	} );
	syncLifecycleEntityRecords( response, ctx, 'restored' );
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged();
	notifyDocumentTrashChanged();
	notifyDocumentArchiveChanged( { action: 'restore' } );
	notifyCollectionRowsChanged();
	notifyRestored(
		response,
		ctx,
		'cortext-document-restore-success',
		undoAction(
			ctx,
			() => trashDocument( record, ctx ),
			'cortext-document-restore-success'
		)
	);
	return response;
}

export async function archiveDocument( record, ctx ) {
	const result = await runDocumentLifecycle( record, ctx, {
		request: () =>
			apiFetch( {
				path: `/cortext/v1/documents/${ record.id }/archive`,
				method: 'POST',
			} ),
		cascadeKey: 'archived',
		saveFailureMessage: archiveSaveFailureMessage(),
		noticeId: 'cortext-document-archive-save-error',
	} );
	if ( ! result ) {
		return null;
	}
	const { response, lifecycleFocusIntent } = result;
	invalidateDocumentLifecycle( ctx );
	notifyDocumentArchiveChanged( { action: 'archive' } );
	ctx.onAfterArchive?.( { record, response, lifecycleFocusIntent } );
	// The response lists the root along with its cascade.
	const archivedCount = response?.archived?.length ?? 1;
	ctx.createSuccessNotice?.( archivedMessage( archivedCount - 1 ), {
		id: 'cortext-document-archive-success',
		type: 'snackbar',
		actions: undoAction(
			ctx,
			() => unarchiveDocument( record, ctx ),
			'cortext-document-archive-success'
		),
	} );
	return response;
}

export async function unarchiveDocument( record, ctx ) {
	const response = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/unarchive`,
		method: 'POST',
	} );
	syncLifecycleEntityRecords( response, ctx, 'restored' );
	invalidateDocumentLifecycle( ctx );
	notifyDocumentArchiveChanged( { action: 'unarchive' } );
	notifyRestored(
		response,
		ctx,
		'cortext-document-unarchive-success',
		undoAction(
			ctx,
			() => archiveDocument( record, ctx ),
			'cortext-document-unarchive-success'
		)
	);
	return response;
}

export async function emptyTrash( ctx ) {
	const response = await apiFetch( {
		path: '/cortext/v1/documents/empty-trash',
		method: 'POST',
	} );
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged();
	notifyDocumentTrashChanged();
	notifyCollectionRowsChanged();
	return response;
}

export async function permanentlyDeleteDocument( record, ctx ) {
	const response = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/permanent-delete`,
		method: 'POST',
	} );
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged();
	notifyDocumentTrashChanged();
	notifyCollectionRowsChanged();
	return response;
}

const FREEZE_NOTICE_ID = 'cortext-document-freeze';

// Locks or unlocks a document. Open editors save first, so nothing typed
// right before locking is lost, then pick up the read-only state from the
// returned record.
async function setDocumentFrozen( record, ctx, frozen ) {
	// Apply the returned record while the editors are still held, so they go
	// straight from the brief lock to the new state without a flash between.
	const response = await runWithEditorsLocked( ctx, async () => {
		const result = await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/${
				frozen ? 'freeze' : 'unfreeze'
			}`,
			method: 'POST',
		} );
		receiveLifecyclePost( result, ctx );
		return result;
	} );
	if ( response === false ) {
		ctx.createErrorNotice?.(
			__( "Couldn't save changes. Lock was canceled.", 'cortext' ),
			{ id: FREEZE_NOTICE_ID, type: 'snackbar' }
		);
		return null;
	}
	notifySidebarTreeChanged();
	notifyCollectionRowsChanged();
	ctx.createSuccessNotice?.(
		frozen
			? __( 'Document locked.', 'cortext' )
			: __( 'Document unlocked.', 'cortext' ),
		{
			id: FREEZE_NOTICE_ID,
			type: 'snackbar',
			actions: undoAction(
				ctx,
				() => setDocumentFrozen( record, ctx, ! frozen ),
				FREEZE_NOTICE_ID
			),
		}
	);
	return response;
}

export function freezeDocument( record, ctx ) {
	return setDocumentFrozen( record, ctx, true );
}

export function unfreezeDocument( record, ctx ) {
	return setDocumentFrozen( record, ctx, false );
}
