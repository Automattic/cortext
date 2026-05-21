/**
 * Map a raw entity record to its document kind.
 *
 * This is the only place that reads post type slugs and chooses a descriptor.
 * Code above `src/documents/` should use hooks instead of branching on these
 * strings directly.
 *
 * Rows live behind dynamic `crtxt_<slug>` post types. Any Cortext post type
 * that is not a page or collection is treated as a row.
 *
 * @param {Object} record Raw entity record from core-data.
 * @return {?string} One of `'page'`, `'collection'`, `'row'`, or `null`.
 */
export function kindFromRecord( record ) {
	if ( ! record || typeof record !== 'object' ) {
		return null;
	}
	if ( typeof record.kind === 'string' && record.kind ) {
		return record.kind;
	}
	if ( record.type === 'crtxt_page' ) {
		return 'page';
	}
	if ( record.type === 'crtxt_collection' ) {
		return 'collection';
	}
	if (
		typeof record.type === 'string' &&
		record.type.startsWith( 'crtxt_' )
	) {
		return 'row';
	}
	return null;
}
