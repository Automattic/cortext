/**
 * Builds the splat path used by the Cortext router for a document. Prefer the
 * server-provided `path`; fall back to the fields already present on the
 * document object without calling another endpoint.
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
