import { __, _n, sprintf } from '@wordpress/i18n';

import { hasFields, hasTrait } from './capabilities';

/**
 * Localized noun for a record (used in aria labels, headers, etc.).
 *
 * @param {Object} record Document record.
 */
export function documentLabel( record ) {
	if ( hasFields( record ) ) {
		return __( 'Collection', 'cortext' );
	}
	if ( hasTrait( record ) ) {
		return __( 'Row', 'cortext' );
	}
	return __( 'Page', 'cortext' );
}

export function restoreErrorMessage( record ) {
	if ( hasFields( record ) ) {
		return __( 'Could not restore collection.', 'cortext' );
	}
	if ( hasTrait( record ) ) {
		return __( 'Could not restore row.', 'cortext' );
	}
	return __( 'Could not restore page.', 'cortext' );
}

export function permanentDeleteErrorMessage( record ) {
	if ( hasFields( record ) ) {
		return __( 'Could not delete collection.', 'cortext' );
	}
	if ( hasTrait( record ) ) {
		return __( 'Could not delete row.', 'cortext' );
	}
	return __( 'Could not delete page.', 'cortext' );
}

export function descendantLabel( counts ) {
	const pages = counts?.pages ?? 0;
	const collections = counts?.collections ?? 0;
	const total = counts?.total ?? 0;
	if ( pages > 0 && collections === 0 ) {
		return sprintf(
			/* translators: %d: number of subpages */
			_n( '%d subpage', '%d subpages', pages, 'cortext' ),
			pages
		);
	}
	if ( collections > 0 && pages === 0 ) {
		return sprintf(
			/* translators: %d: number of nested collections */
			_n( '%d collection', '%d collections', collections, 'cortext' ),
			collections
		);
	}
	return sprintf(
		/* translators: %d: number of nested trashed documents */
		_n( '%d nested item', '%d nested items', total, 'cortext' ),
		total
	);
}

/**
 * Confirmation copy for permanent delete. Schema-bearing documents take rows
 * down with them, so the dialog asks the user to type the title.
 *
 * @param {Object} record Document being deleted.
 * @param {Object} counts Cascade counts `{ pages, collections, total }`.
 */
export function permanentDeleteConfirmation( record, counts ) {
	const total = counts?.total ?? 0;
	if ( hasFields( record ) ) {
		return {
			title: __( 'Permanently delete collection?', 'cortext' ),
			message: __(
				"Permanently delete this collection and all its rows? You can't undo this.",
				'cortext'
			),
			requireTypeToConfirm: true,
		};
	}
	if ( hasTrait( record ) ) {
		if ( total === 0 ) {
			return {
				title: __( 'Permanently delete row?', 'cortext' ),
				message: __(
					"Permanently delete this row? You can't undo this.",
					'cortext'
				),
			};
		}
		return {
			title: __( 'Permanently delete row?', 'cortext' ),
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
	}
	if ( total === 0 ) {
		return {
			title: __( 'Permanently delete page?', 'cortext' ),
			message: __(
				"Permanently delete this page? You can't undo this.",
				'cortext'
			),
		};
	}
	const pages = counts?.pages ?? 0;
	const collections = counts?.collections ?? 0;
	if ( pages > 0 && collections === 0 ) {
		return {
			title: __( 'Permanently delete page?', 'cortext' ),
			message: sprintf(
				/* translators: %d: number of subpages deleted along with the page. */
				_n(
					"Permanently delete this page and %d subpage? You can't undo this.",
					"Permanently delete this page and %d subpages? You can't undo this.",
					pages,
					'cortext'
				),
				pages
			),
		};
	}
	return {
		title: __( 'Permanently delete page?', 'cortext' ),
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
}
