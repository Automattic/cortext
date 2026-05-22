import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { POST_TYPE } from '../../components/page-queries';
import { computeDocumentUri } from '../../router/useResolveEntity';
import { notifyDocumentTrashChanged } from '../../hooks/documentTrashInvalidation';
import { cascadeFavorites } from '../favorites';
import { afterPageTrash, applyInvalidationPack } from '../invalidation';

/**
 * Page actions used by the sidebar. Pages are hierarchical, can own child
 * pages, and can have their own icon. The REST trash response carries the
 * cascade ids so the favorites cleanup does not need a local page tree walk.
 */
const pageDescriptor = {
	features: {
		hierarchy: true,
		canCreateChild: true,
		hasOwnIcon: true,
	},

	uri( record ) {
		return computeDocumentUri( record );
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
		// The server returns the cascade alongside the trashed page: child
		// pages plus any inline collections that came with them. The favorites
		// cleanup just consumes that list, so the page tree never has to be
		// walked on the client.
		const cascade = deleted?.cascade_deleted ?? {};
		await cascadeFavorites(
			ctx,
			{
				page: new Set( [
					Number( record.id ),
					...( cascade.pages ?? [] ).map( Number ),
				] ),
				collection: new Set(
					( cascade.collections ?? [] ).map( Number )
				),
				row: new Set( ( cascade.rows ?? [] ).map( Number ) ),
			},
			__(
				'Page moved to Trash, but Favorites could not be updated.',
				'cortext'
			)
		);
		ctx.onAfterTrash?.( { kind: 'page', record } );
	},
};

export default pageDescriptor;
