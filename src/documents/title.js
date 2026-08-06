import { __, sprintf } from '@wordpress/i18n';

/**
 * Resolve a display title from a raw record. Core-data may return title
 * objects, plain strings, or nothing; every sidebar list should fall back to
 * the same `(untitled)` label.
 *
 * @param {?Object} record Document record (page, collection, or favorite).
 * @return {string} Trimmed display title, or `(untitled)` if blank.
 */
export function documentTitle( record ) {
	if ( ! record ) {
		return __( '(untitled)', 'cortext' );
	}
	const title = record.title;
	if ( typeof title === 'string' ) {
		return title.trim() || __( '(untitled)', 'cortext' );
	}
	return (
		title?.rendered?.trim() ||
		title?.raw?.trim() ||
		__( '(untitled)', 'cortext' )
	);
}

/**
 * Secondary line for a row in the compact lists: the collection it belongs to.
 * Only rows carry a parent collection on the wire, so pages and collections
 * get an empty string.
 *
 * @param {?Object} doc Document summary from `/cortext/v1/documents`.
 * @return {string} `in <Collection>`, or an empty string.
 */
export function collectionHint( doc ) {
	const collectionTitle = doc?.collection?.title?.trim?.();
	if ( ! collectionTitle ) {
		return '';
	}
	return sprintf(
		/* translators: %s: parent collection title */
		__( 'in %s', 'cortext' ),
		collectionTitle
	);
}
