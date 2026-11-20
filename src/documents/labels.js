import { __, _n, sprintf } from '@wordpress/i18n';

import { definesTrait } from './capabilities';

/**
 * Kind of document, as shown to people: a collection or any other document.
 *
 * @param {Object} record Document record.
 */
export function documentTypeLabel( record ) {
	if ( definesTrait( record ) ) {
		return __( 'Collection', 'cortext' );
	}
	return __( 'Document', 'cortext' );
}

/**
 * Label for descendants that will be restored or deleted with a trash root.
 *
 * @param {Object} counts Cascade counts `{ total }`.
 */
export function nestedDocumentCountLabel( counts ) {
	const total = counts?.total ?? 0;
	return sprintf(
		/* translators: %d: number of nested trashed documents */
		_n( '%d nested document', '%d nested documents', total, 'cortext' ),
		total
	);
}

/**
 * Confirmation copy for permanent delete. Collections take their rows down with
 * them and other documents their nested documents, so in both cases the dialog
 * asks the user to type the title.
 *
 * @param {Object} record Document being deleted.
 * @param {Object} counts Cascade counts `{ total }`.
 */
export function permanentDeleteDocumentConfirmation( record, counts ) {
	const total = counts?.total ?? 0;
	if ( definesTrait( record ) ) {
		return {
			title: __( 'Delete this document permanently?', 'cortext' ),
			message: __(
				"Delete this collection and all documents in it? This can't be undone.",
				'cortext'
			),
			requireTypeToConfirm: true,
		};
	}
	if ( total === 0 ) {
		return {
			title: __( 'Delete this document permanently?', 'cortext' ),
			message: __(
				"Delete this document permanently? This can't be undone.",
				'cortext'
			),
		};
	}
	return {
		title: __( 'Delete this document permanently?', 'cortext' ),
		message: sprintf(
			/* translators: %d: number of nested documents deleted along with the document. */
			_n(
				"Delete this document and %d nested document? This can't be undone.",
				"Delete this document and %d nested documents? This can't be undone.",
				total,
				'cortext'
			),
			total
		),
		requireTypeToConfirm: true,
	};
}
