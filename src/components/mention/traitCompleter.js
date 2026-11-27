import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useEffect, useState } from '@wordpress/element';
import { addFilter } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';

import { writeDocumentTraits } from '../../documents/writeTraits';
import useDocumentTraits from '../../hooks/useDocumentTraits';
import { fetchCortextLinkSuggestions } from '../fetchCortextLinkSuggestions';
import { getMentionCompletion, getMentionOptionLabel } from './completer';

export const TRAIT_COMPLETER_NAME = 'cortext/trait';

const SEARCH_DELAY_MS = 250;

// `#2026` and `#123` are years and issue numbers, not traits.
export function isTraitSearch( search ) {
	return Boolean( search ) && ! /^\d+$/.test( search );
}

// Like a hashtag, `#` only starts a trait at the start of a word, so
// `page#section` and `C#` stay plain text.
export function allowTraitContext( before ) {
	return before === '' || /\s$/.test( before );
}

// Collections matching the search that the document doesn't carry yet. Every
// option knows how to apply itself, because `getOptionCompletion` runs outside
// React and can't read the editor this completer is open in.
function useTraitOptions( search ) {
	const documentId = useSelect(
		( select ) => select( editorStore ).getCurrentPostId(),
		[]
	);
	const { collections, hasResolved } = useDocumentTraits(
		search ? documentId : null
	);
	const { invalidateResolution } = useDispatch( coreStore );
	const { createErrorNotice } = useDispatch( noticesStore );
	const [ options, setOptions ] = useState( [] );

	// Only rows carry traits for now: a page's first trait would turn it into
	// a row and take it out of the page tree.
	const isRow = hasResolved && collections.length > 0;

	useEffect( () => {
		if ( ! isRow || ! search ) {
			setOptions( [] );
			return undefined;
		}
		let isCanceled = false;
		const timer = setTimeout( async () => {
			const results = await fetchCortextLinkSuggestions( search, {
				perPage: 10,
				collectionsOnly: true,
			} );
			if ( isCanceled ) {
				return;
			}
			const currentIds = collections.map(
				( collection ) => collection.id
			);
			const apply = ( collectionId ) =>
				writeDocumentTraits(
					documentId,
					[ ...currentIds, collectionId ],
					invalidateResolution
				).catch( () =>
					createErrorNotice(
						__( "Couldn't add the trait.", 'cortext' ),
						{ type: 'snackbar' }
					)
				);
			setOptions(
				results
					.filter( ( result ) => ! currentIds.includes( result.id ) )
					.map( ( result ) => ( {
						key: `trait-${ result.id }`,
						value: { ...result, kind: 'document', apply },
						label: getMentionOptionLabel( result ),
					} ) )
			);
		}, SEARCH_DELAY_MS );
		return () => {
			isCanceled = true;
			clearTimeout( timer );
		};
	}, [
		collections,
		createErrorNotice,
		documentId,
		invalidateResolution,
		isRow,
		search,
	] );

	return options;
}

function useTraitItems( filterValue ) {
	return [
		useTraitOptions( isTraitSearch( filterValue ) ? filterValue : '' ),
	];
}

// Picking a trait applies it to the document and leaves a mention of the
// collection in the text. The mention is only a note: deleting it keeps the
// trait, which is removed from the Traits chips.
export function getTraitCompletion( option ) {
	option?.apply?.( option.id );
	return getMentionCompletion( option );
}

export const traitCompleter = {
	name: TRAIT_COMPLETER_NAME,
	triggerPrefix: '#',
	useItems: useTraitItems,
	allowContext: allowTraitContext,
	getOptionCompletion: getTraitCompletion,
};

export function withCortextTraitCompleter( completers ) {
	return [
		...completers.filter(
			( completer ) => completer?.name !== TRAIT_COMPLETER_NAME
		),
		traitCompleter,
	];
}

addFilter(
	'editor.Autocomplete.completers',
	'cortext/trait-completer',
	withCortextTraitCompleter
);
