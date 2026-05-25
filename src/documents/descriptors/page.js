import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import PageIcon from '../../components/PageIcon';
import { POST_TYPE } from '../../components/page-queries';
import { computeDocumentUri } from '../../router/useResolveEntity';
import { notifyDocumentTrashChanged } from '../../hooks/documentTrashInvalidation';
import { cascadeFavorites } from '../favorites';
import { afterPageTrash, applyInvalidationPack } from '../invalidation';

/**
 * Page actions used by the sidebar. Pages can have child pages and their own
 * icon. The REST trash response includes the cascade ids, so Favorites can be
 * cleaned up without walking the page tree in the client.
 */
const pageDescriptor = {
	features: {
		hierarchy: true,
		canCreateChild: true,
		hasOwnIcon: true,
	},

	kindLabel: __( 'Page', 'cortext' ),

	// Compact-list fallback glyph for pages with no custom icon. Custom icons
	// take precedence and are rendered by `useDocumentRecord` directly.
	fallbackListIcon( size = 16 ) {
		return <PageIcon icon="" size={ size } />;
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
		// The server returns the cascade with the trashed page: child pages plus
		// any inline collections that came with them. Favorites can use that
		// list directly instead of walking the page tree in the client.
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

	async restore( record, ctx ) {
		await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/restore`,
			method: 'POST',
		} );
		applyInvalidationPack( ctx.invalidateResolution, afterPageTrash );
		notifyDocumentTrashChanged();
	},

	// Return the REST response so the caller can navigate away if the open page
	// is in `deleted`. The server prunes favorites that still point at deleted
	// pages on the next read, so there is no client cleanup here.
	async permanentDelete( record, ctx ) {
		const response = await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/permanent-delete`,
			method: 'POST',
		} );
		applyInvalidationPack( ctx.invalidateResolution, afterPageTrash );
		notifyDocumentTrashChanged();
		return response;
	},

	restoreErrorMessage: __( 'Could not restore page.', 'cortext' ),

	permanentDeleteErrorMessage: __( 'Could not delete page.', 'cortext' ),

	descendantLabel( counts ) {
		// Mixed subtrees (subpages + owned inline collections) use
		// "%d nested items". Pure subtrees keep the more specific noun.
		if ( counts.pages > 0 && counts.collections === 0 ) {
			return sprintf(
				/* translators: %d: number of subpages */
				_n( '%d subpage', '%d subpages', counts.pages, 'cortext' ),
				counts.pages
			);
		}
		if ( counts.collections > 0 && counts.pages === 0 ) {
			return sprintf(
				/* translators: %d: number of nested inline collections */
				_n(
					'%d collection',
					'%d collections',
					counts.collections,
					'cortext'
				),
				counts.collections
			);
		}
		return sprintf(
			/* translators: %d: number of nested trashed documents */
			_n( '%d nested item', '%d nested items', counts.total, 'cortext' ),
			counts.total
		);
	},

	permanentDeleteConfirmation( counts ) {
		const total = counts?.total ?? 0;
		const title = __( 'Permanently delete page?', 'cortext' );
		if ( total === 0 ) {
			return {
				title,
				message: __(
					"Permanently delete this page? You can't undo this.",
					'cortext'
				),
			};
		}
		if ( counts.pages > 0 && counts.collections === 0 ) {
			return {
				title,
				message: sprintf(
					/* translators: %d: number of subpages that will be deleted along with the page. */
					_n(
						"Permanently delete this page and %d subpage? You can't undo this.",
						"Permanently delete this page and %d subpages? You can't undo this.",
						counts.pages,
						'cortext'
					),
					counts.pages
				),
			};
		}
		return {
			title,
			message: sprintf(
				/* translators: %d: number of nested trashed items deleted along with the page. */
				_n(
					"Permanently delete this page and %d nested item? You can't undo this.",
					"Permanently delete this page and %d nested items? You can't undo this.",
					total,
					'cortext'
				),
				total
			),
		};
	},
};

export default pageDescriptor;
