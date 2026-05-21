import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { computeCollectionUri } from '../../router/useResolveEntity';
import { notifyDocumentTrashChanged } from '../../hooks/documentTrashInvalidation';
import { filterFavoritesByDeletedIds } from '../favorites';
import {
	afterCollectionDuplicate,
	afterCollectionTrash,
	applyInvalidationPack,
} from '../invalidation';

/**
 * Collection actions used by the sidebar. Collections are leaves in the tree,
 * so their rows expose before/after drops only. Duplication stays on the
 * documents endpoint because the server copies the schema and rows together.
 */
const collectionDescriptor = {
	features: {
		hierarchy: false,
		canCreateChild: false,
		hasOwnIcon: false,
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
		// same data shape as page trash so server-provided ids can replace this
		// local set later.
		const deletedIds = { collection: new Set( [ Number( record.id ) ] ) };
		try {
			await ctx.setFavorites( ( current ) =>
				filterFavoritesByDeletedIds( current, deletedIds )
			);
		} catch ( err ) {
			ctx.onFavoritesError?.(
				err?.message ??
					__(
						'Moved the collection to Trash, but could not update Favorites.',
						'cortext'
					)
			);
		}
		if ( ctx.selectedCollectionId === record.id ) {
			ctx.navigate?.( { to: '/' } );
		}
		ctx.onAfterTrash?.( { kind: 'collection', record } );
	},
};

export default collectionDescriptor;
