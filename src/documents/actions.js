import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useCallback } from '@wordpress/element';
import { useDispatch } from '@wordpress/data';

import { DOCUMENT_POST_TYPE } from '../collections';
import { computeDocumentUri } from '../router/useResolveEntity';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { notifyCollectionRowsChanged } from '../hooks/rowInvalidation';
import { cascadeFavorites } from './favorites';
import { afterDocumentTrash, applyInvalidationPack } from './invalidation';

function collectCascadeIds( record, cascade ) {
	const ids = new Set( [ Number( record.id ) ] );
	if ( Array.isArray( cascade ) ) {
		cascade.forEach( ( id ) => ids.add( Number( id ) ) );
	}
	return ids;
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

// First rename of a draft promotes status to private so core regenerates
// `post_name` from the new title via `wp_unique_post_slug(sanitize_title())`.
export async function renameDocument( record, title, ctx ) {
	const payload = { id: record.id, title };
	if ( record.status === 'draft' ) {
		payload.status = 'private';
	}
	await ctx.saveEntityRecord( 'postType', DOCUMENT_POST_TYPE, payload );
	await ctx.touchRecent( { id: record.id } );
}

export async function duplicateDocument( record, ctx ) {
	const created = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/duplicate`,
		method: 'POST',
	} );
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
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
	const deleted = await apiFetch( {
		path: `/wp/v2/crtxt_documents/${ record.id }`,
		method: 'DELETE',
	} );
	const trashed = deleted?.previous ?? deleted;
	if ( trashed?.id ) {
		ctx.receiveEntityRecords( 'postType', DOCUMENT_POST_TYPE, [ trashed ] );
	}
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifyDocumentTrashChanged();
	const cascadeIds = collectCascadeIds( record, deleted?.cascade_deleted );
	await cascadeFavorites(
		ctx,
		cascadeIds,
		__(
			'Document moved to Trash, but Favorites could not be updated.',
			'cortext'
		)
	);
	ctx.onAfterTrash?.( { record } );
}

export async function restoreDocument( record, ctx ) {
	await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/restore`,
		method: 'POST',
	} );
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifyDocumentTrashChanged();
	notifyCollectionRowsChanged();
}

export async function permanentlyDeleteDocument( record, ctx ) {
	const response = await apiFetch( {
		path: `/cortext/v1/documents/${ record.id }/permanent-delete`,
		method: 'POST',
	} );
	applyInvalidationPack( ctx.invalidateResolution, afterDocumentTrash );
	notifyDocumentTrashChanged();
	notifyCollectionRowsChanged();
	return response;
}
