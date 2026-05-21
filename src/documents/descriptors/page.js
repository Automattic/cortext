import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { POST_TYPE } from '../../components/page-queries';
import { collectDescendants } from '../../components/pages-tree';
import { notifyDocumentTrashChanged } from '../../hooks/documentTrashInvalidation';
import { filterFavoritesByDeletedIds } from '../favorites';
import { afterPageTrash, applyInvalidationPack } from '../invalidation';

/**
 * Page actions used by the sidebar. Pages are hierarchical, can own child
 * pages, and can have their own icon. Trash still computes the affected page
 * and collection ids locally until the server returns that list.
 */
const pageDescriptor = {
	features: {
		hierarchy: true,
		canCreateChild: true,
		hasOwnIcon: true,
	},

	// First rename of a draft promotes status to private so core regenerates
	// post_name from the new title via wp_unique_post_slug(sanitize_title(...)).
	async rename( record, title, ctx ) {
		const payload = { id: record.id, title };
		if ( record.status === 'draft' ) {
			payload.status = 'private';
		}
		await ctx.saveEntityRecord( 'postType', POST_TYPE, payload );
		await ctx.touchRecent( { kind: 'page', id: record.id } );
	},

	async duplicate( record, ctx ) {
		const sourceTitle = record.title?.raw ?? record.title?.rendered ?? '';
		const created = await ctx.saveEntityRecord( 'postType', POST_TYPE, {
			status: 'private',
			title: sourceTitle
				? /* translators: %s: source page title */
				  `${ sourceTitle } ${ __( '(copy)', 'cortext' ) }`
				: __( 'Untitled (copy)', 'cortext' ),
			content: record.content?.raw ?? '',
			parent: record.parent || 0,
			menu_order: ( record.menu_order || 0 ) + 1,
		} );
		if ( created?.id ) {
			if ( record.parent ) {
				ctx.expand?.( record.parent );
			}
			ctx.onSelect?.( created.id, created );
		}
		return created;
	},

	// Soft-delete: the server trashes descendants too, and Trash can restore
	// them later, so this path does not ask for confirmation.
	//
	// Do not use core-data's `deleteEntityRecord` for this path: it removes
	// the current post from the raw record store before the canvas has
	// finished its block-editor selection writes, which can crash core-data.
	// Calling REST directly is intentional. Put the returned trashed record
	// back into core-data so the editor keeps rendering while the lists refresh.
	async trash( record, ctx ) {
		const deleted = await apiFetch( {
			path: `/wp/v2/crtxt_pages/${ record.id }`,
			method: 'DELETE',
		} );
		const trashed = deleted?.previous ?? deleted;
		if ( trashed?.id ) {
			ctx.receiveEntityRecords( 'postType', POST_TYPE, [ trashed ] );
		}
		applyInvalidationPack( ctx.invalidateResolution, afterPageTrash );
		notifyDocumentTrashChanged();
		await dropCascadedFavorites( record.id, ctx );
		ctx.onAfterTrash?.( { kind: 'page', record } );
	},
};

// Compute the trash ids locally for now: the page, its descendants, and any
// inline collections owned by those pages. A later server response can replace
// this local set without changing the favorite filtering step.
async function dropCascadedFavorites( pageId, ctx ) {
	const trashedPageIds = new Set( [
		Number( pageId ),
		...collectDescendants( Number( pageId ), ctx.pages ?? [] ),
	] );
	const trashedCollectionIds = new Set(
		( ctx.collections ?? [] )
			.filter( ( collection ) =>
				trashedPageIds.has( Number( collection.parent ?? 0 ) )
			)
			.map( ( collection ) => Number( collection.id ) )
	);
	const deletedIds = {
		page: trashedPageIds,
		collection: trashedCollectionIds,
	};

	try {
		await ctx.setFavorites( ( current ) =>
			filterFavoritesByDeletedIds( current, deletedIds )
		);
	} catch ( err ) {
		ctx.onFavoritesError?.(
			err?.message ??
				__(
					'Page moved to Trash, but Favorites could not be updated.',
					'cortext'
				)
		);
	}
}

export default pageDescriptor;
