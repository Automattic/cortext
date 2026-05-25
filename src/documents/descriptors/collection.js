import { __, _n, sprintf } from '@wordpress/i18n';
import { Icon, table } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';

import { computeCollectionUri } from '../../router/useResolveEntity';
import { notifyDocumentTrashChanged } from '../../hooks/documentTrashInvalidation';
import { cascadeFavorites } from '../favorites';
import {
	afterCollectionDuplicate,
	afterCollectionTrash,
	applyInvalidationPack,
} from '../invalidation';

/**
 * Collection actions used by the sidebar. Collections are leaves in the tree,
 * so their rows only expose before/after drops. Duplication stays on the
 * documents endpoint because the server copies both schema and rows.
 */
const collectionDescriptor = {
	features: {
		hierarchy: false,
		canCreateChild: false,
		hasOwnIcon: false,
	},

	kindLabel: __( 'Collection', 'cortext' ),

	fallbackListIcon( size = 16 ) {
		return <Icon icon={ table } size={ size } />;
	},

	uri( record ) {
		return computeCollectionUri( record );
	},

	async rename( record, title, ctx ) {
		await ctx.saveEntityRecord( 'postType', 'crtxt_collection', {
			id: record.id,
			title,
		} );
	},

	async duplicate( record, ctx ) {
		const created = await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/duplicate`,
			method: 'POST',
		} );
		applyInvalidationPack(
			ctx.invalidateResolution,
			afterCollectionDuplicate
		);
		// The server reports fields it skipped. Relations are the usual case,
		// but failed field inserts come through the same list.
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
			ctx.onAutoRename?.( { kind: 'collection', id: created.id } );
			ctx.navigate?.( {
				to: '/$',
				params: { _splat: computeCollectionUri( created ) },
			} );
		}
		return created;
	},

	async trash( record, ctx ) {
		await apiFetch( {
			path: `/wp/v2/crtxt_collections/${ record.id }`,
			method: 'DELETE',
		} );
		applyInvalidationPack( ctx.invalidateResolution, afterCollectionTrash );
		notifyDocumentTrashChanged();
		// For now, Favorites only needs to drop the collection itself. Keep the
		// same shape as page trash so server-provided ids can replace this
		// local set later.
		await cascadeFavorites(
			ctx,
			{ collection: new Set( [ Number( record.id ) ] ) },
			__(
				'Moved the collection to Trash, but could not update Favorites.',
				'cortext'
			)
		);
		if ( ctx.selectedCollectionId === record.id ) {
			ctx.navigate?.( { to: '/' } );
		}
		ctx.onAfterTrash?.( { kind: 'collection', record } );
	},

	async restore( record, ctx ) {
		await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/restore`,
			method: 'POST',
		} );
		applyInvalidationPack( ctx.invalidateResolution, afterCollectionTrash );
		notifyDocumentTrashChanged();
	},

	async permanentDelete( record, ctx ) {
		const response = await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/permanent-delete`,
			method: 'POST',
		} );
		applyInvalidationPack( ctx.invalidateResolution, afterCollectionTrash );
		notifyDocumentTrashChanged();
		return response;
	},

	restoreErrorMessage: __( 'Could not restore collection.', 'cortext' ),

	permanentDeleteErrorMessage: __(
		'Could not delete collection.',
		'cortext'
	),

	// Collections may contain rows that are not shown in Trash, so say so and
	// ask for the title before final delete.
	permanentDeleteConfirmation() {
		return {
			title: __( 'Permanently delete collection?', 'cortext' ),
			message: __(
				"Permanently delete this collection and all its rows? You can't undo this.",
				'cortext'
			),
			requireTypeToConfirm: true,
		};
	},
};

export default collectionDescriptor;
