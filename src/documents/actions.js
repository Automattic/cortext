import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useCallback } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';

import { DOCUMENT_POST_TYPE } from '../collections';
import { computeDocumentUri } from '../router/useResolveEntity';
import { notifyDocumentArchiveChanged } from '../hooks/documentArchiveInvalidation';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';
import { notifySidebarTreeChanged } from '../hooks/sidebarTreeInvalidation';
import { cascadeFavorites } from './favorites';
import { afterDocumentTrash, applyInvalidationPack } from './invalidation';

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

function invalidateDocumentLifecycle( ctx ) {
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifySidebarTreeChanged();
	notifyCollectionRowsChanged();
}

export function restoredDocumentStatusMessage( status ) {
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

export function archiveSaveFailureMessage() {
	return __( 'Could not save changes. Archive was canceled.', 'cortext' );
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
		payload
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
	const created = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/duplicate`,
		method: 'POST',
	} );
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
					'%d field was not copied to the new collection. Add it again if you need it.',
					'%d fields were not copied to the new collection. Add them again if you need them.',
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

// Soft-delete: server trashes descendants. Avoid `deleteEntityRecord` so
// core-data does not drop the open record before the editor finishes its
// block selection writes.
export async function trashDocument( record, ctx ) {
	const lifecycleFocusIntent =
		ctx.captureLifecycleFocusIntent?.( record ) ?? null;
	try {
		const deleted = await apiFetch( {
			path: `/wp/v2/crtxt_documents/${ record.id }`,
			method: 'DELETE',
		} );
		syncLifecycleEntityRecords( deleted, ctx, 'cascade_deleted' );
		applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
		notifySidebarTreeChanged();
		notifyDocumentTrashChanged();
		notifyDocumentArchiveChanged( { action: 'trash' } );
		const cascadeIds = collectCascadeIds(
			record,
			deleted?.cascade_deleted
		);
		await cascadeFavorites(
			ctx,
			cascadeIds,
			__(
				'Document moved to Trash, but Favorites could not be updated.',
				'cortext'
			)
		);
		ctx.onAfterTrash?.( { record, lifecycleFocusIntent } );
	} catch ( error ) {
		ctx.cancelLifecycleFocusIntent?.( lifecycleFocusIntent );
		throw error;
	}
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
	return response;
}

export async function archiveDocument( record, ctx ) {
	const lifecycleFocusIntent =
		ctx.captureLifecycleFocusIntent?.( record ) ?? null;
	try {
		const didFlush = await ctx.flushActiveEditor?.();
		if ( didFlush === false ) {
			ctx.cancelLifecycleFocusIntent?.( lifecycleFocusIntent );
			ctx.createErrorNotice?.( archiveSaveFailureMessage(), {
				id: 'cortext-document-archive-save-error',
				type: 'snackbar',
			} );
			return null;
		}
		const response = await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/archive`,
			method: 'POST',
		} );
		syncLifecycleEntityRecords( response, ctx, 'archived' );
		invalidateDocumentLifecycle( ctx );
		notifyDocumentArchiveChanged( { action: 'archive' } );
		ctx.onAfterArchive?.( { record, response, lifecycleFocusIntent } );
		return response;
	} catch ( error ) {
		ctx.cancelLifecycleFocusIntent?.( lifecycleFocusIntent );
		throw error;
	}
}

export async function unarchiveDocument( record, ctx ) {
	const response = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/unarchive`,
		method: 'POST',
	} );
	syncLifecycleEntityRecords( response, ctx, 'restored' );
	invalidateDocumentLifecycle( ctx );
	notifyDocumentArchiveChanged( { action: 'unarchive' } );
	ctx.createSuccessNotice?.(
		restoredDocumentStatusMessage( response?.post?.status ),
		{
			id: 'cortext-document-unarchive-success',
			type: 'snackbar',
		}
	);
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
