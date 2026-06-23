import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';

import { fetchCortextLinkSuggestions } from '../fetchCortextLinkSuggestions';

export const MENTION_COMPLETER_NAME = 'cortext/mention';

export async function fetchMentionOptions( search ) {
	const documents = await fetchCortextLinkSuggestions( search, {
		perPage: 10,
	} );

	return documents.map( ( document ) => {
		const option = {
			...document,
			kind: 'document',
		};
		return {
			...option,
			key: `document-${ document.id }`,
			value: option,
			label: document.title || __( '(untitled)', 'cortext' ),
		};
	} );
}

export function getMentionCompletion( option ) {
	if ( option?.kind !== 'document' ) {
		return '';
	}

	const { id, title, url } = option;
	const label = title || __( '(untitled)', 'cortext' );
	return (
		<a
			className="cortext-mention"
			data-crtxt-mention={ String( id ) }
			href={ url }
		>
			{ label }
		</a>
	);
}

export function getMentionOptionLabel( option ) {
	return option?.title || __( '(untitled)', 'cortext' );
}

export function getMentionOptionKeywords( option ) {
	return getMentionOptionLabel( option ).split( /\s+/ );
}

export const mentionCompleter = {
	name: MENTION_COMPLETER_NAME,
	triggerPrefix: '@',
	isDebounced: true,
	options: fetchMentionOptions,
	getOptionLabel: getMentionOptionLabel,
	getOptionKeywords: getMentionOptionKeywords,
	getOptionCompletion: getMentionCompletion,
};

// Cortext claims the `@` trigger for document mentions, so any other
// `@`-prefixed completer (notably core's user mentions) is dropped in favor of
// ours. Filter by name too so re-applying the filter never duplicates ours.
export function withCortextMentionCompleter( completers ) {
	const withoutMentionPrefix = completers.filter(
		( completer ) =>
			completer?.name !== MENTION_COMPLETER_NAME &&
			completer?.triggerPrefix !== '@'
	);
	return [ mentionCompleter, ...withoutMentionPrefix ];
}

addFilter(
	'editor.Autocomplete.completers',
	'cortext/mention-completer',
	withCortextMentionCompleter
);
