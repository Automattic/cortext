/**
 * Builds the splat path used by the Cortext router for a given document.
 * Mirrors the `path` field that `/cortext/v1/documents` and `/cortext/v1/recents`
 * already emit, so the caller can either trust the server's `path` or
 * recompute it from the rest of the document fields without hitting another
 * endpoint.
 *
 * @param {{
 *   kind?: 'page'|'row',
 *   id?: number,
 *   path?: string,
 *   collection?: { path?: string },
 * }} document
 *
 * @return {string} Splat path like `page/about-us-12` or `collection/projects-7`.
 *                   Empty string when the document is unrecognised.
 */
export default function getDocumentUrl( document ) {
	if ( ! document ) {
		return '';
	}

	if ( typeof document.path === 'string' && document.path !== '' ) {
		return document.path;
	}

	if ( document.kind === 'row' && document.collection?.path ) {
		return document.collection.path;
	}

	if ( document.kind === 'page' && typeof document.id === 'number' ) {
		return `page/${ document.id }`;
	}

	return '';
}
