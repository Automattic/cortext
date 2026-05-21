import { __ } from '@wordpress/i18n';

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
