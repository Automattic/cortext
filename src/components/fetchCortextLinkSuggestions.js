import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';
import { __ } from '@wordpress/i18n';

import { DOCUMENT_POST_TYPE } from '../collections';

// Cortext-scoped source for Gutenberg's link autocomplete.
//
// The default picker queries `wp/v2/search`, which returns all site content
// and never Cortext documents: `crtxt_document` is `public=false` and
// `exclude_from_search=true`, so it stays out of that search. This hits the
// document REST base instead, so the picker only offers Cortext documents,
// rows included. CortextLinkSuggestions installs it on the block-editor store,
// where both LinkControl and URLInput read it.
//
// Same signature as `__experimentalFetchLinkSuggestions`. We ignore `type` and
// `subtype` from `searchOptions` because the answer is always documents, and
// link to each document's permalink.
export async function fetchCortextLinkSuggestions(
	search,
	searchOptions = {}
) {
	const { isInitialSuggestions, page = 1 } = searchOptions;
	const perPage = searchOptions.perPage ?? ( isInitialSuggestions ? 3 : 20 );

	// `crtxt_documents` is the REST base of the `crtxt_document` post type.
	// Edit context returns drafts/private docs and the plain `title.raw`.
	const records = await apiFetch( {
		path: addQueryArgs( '/wp/v2/crtxt_documents', {
			search,
			page,
			per_page: perPage,
			context: 'edit',
			status: [ 'draft', 'private', 'publish' ],
			_fields: 'id,link,title',
		} ),
	} ).catch( () => [] ); // Fail by returning no suggestions, like core.

	return ( Array.isArray( records ) ? records : [] )
		.map( ( record ) => ( {
			id: record.id,
			url: record.link,
			title: record.title?.raw || __( '(no title)', 'cortext' ),
			type: DOCUMENT_POST_TYPE,
			kind: 'post-type',
		} ) )
		.filter( ( suggestion ) => suggestion.id && suggestion.url );
}
