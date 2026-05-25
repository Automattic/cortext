import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

import { notifyCollectionRowsChanged } from '../../hooks/rowInvalidation';
import { notifyDocumentTrashChanged } from '../../hooks/documentTrashInvalidation';

/**
 * Row actions used by the trash list. Rows do not have their own sidebar row
 * yet, so rename, duplicate, and the initial trash action still live in the
 * DataView. SidebarTrash handles restore and permanent delete.
 *
 * Rows are not in core-data, so refresh runs through
 * `notifyCollectionRowsChanged` instead of `invalidateResolution`.
 */
const rowDescriptor = {
	features: {
		hierarchy: false,
		canCreateChild: false,
		hasOwnIcon: false,
	},

	async restore( record ) {
		await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/restore`,
			method: 'POST',
		} );
		notifyCollectionRowsChanged( record.collection?.id ?? null );
		notifyDocumentTrashChanged();
	},

	async permanentDelete( record ) {
		const response = await apiFetch( {
			path: `/cortext/v1/documents/${ record.id }/permanent-delete`,
			method: 'POST',
		} );
		notifyCollectionRowsChanged( record.collection?.id ?? null );
		notifyDocumentTrashChanged();
		return response;
	},

	restoreErrorMessage: __( 'Could not restore row.', 'cortext' ),

	permanentDeleteErrorMessage: __( 'Could not delete row.', 'cortext' ),

	// A row that owns an inline collection drags it down via
	// `_cortext_trashed_by_owner_page`, so the trash list folds the collection
	// under the row. The generic "nested item" phrasing covers that.
	descendantLabel( counts ) {
		return sprintf(
			/* translators: %d: number of nested trashed items under the row. */
			_n( '%d nested item', '%d nested items', counts.total, 'cortext' ),
			counts.total
		);
	},

	permanentDeleteConfirmation( counts ) {
		const total = counts?.total ?? 0;
		const title = __( 'Permanently delete row?', 'cortext' );
		if ( total === 0 ) {
			return {
				title,
				message: __(
					"Permanently delete this row? You can't undo this.",
					'cortext'
				),
			};
		}
		return {
			title,
			message: sprintf(
				/* translators: %d: number of nested trashed items deleted along with the row. */
				_n(
					"Permanently delete this row and %d nested item? You can't undo this.",
					"Permanently delete this row and %d nested items? You can't undo this.",
					total,
					'cortext'
				),
				total
			),
		};
	},
};

export default rowDescriptor;
