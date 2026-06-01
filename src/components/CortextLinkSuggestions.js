import { useSelect, useDispatch } from '@wordpress/data';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { useEffect } from '@wordpress/element';

import { fetchCortextLinkSuggestions } from './fetchCortextLinkSuggestions';

// Scopes the editor's link picker to Cortext documents.
//
// On the block-editor store it points `__experimentalFetchLinkSuggestions` at
// Cortext documents and turns off the picker's "Create" action, so it never
// spawns a stray page.
//
// `@wordpress/editor`'s useBlockEditorSettings overwrites these settings on
// every recompute, so passing them through the editor settings never sticks.
// This component renders nothing: it lives inside EditorProvider and re-applies
// them whenever Gutenberg has replaced our fetcher.
export default function CortextLinkSuggestions() {
	// Watched so we notice when Gutenberg swaps our fetcher back out: when this
	// changes, the effect re-runs and re-applies every override.
	const current = useSelect(
		( select ) =>
			select( blockEditorStore ).getSettings()
				.__experimentalFetchLinkSuggestions,
		[]
	);
	const { updateSettings } = useDispatch( blockEditorStore );

	useEffect( () => {
		if ( current !== fetchCortextLinkSuggestions ) {
			updateSettings( {
				__experimentalFetchLinkSuggestions: fetchCortextLinkSuggestions,
				__experimentalCreatePageEntity: undefined,
				__experimentalUserCanCreatePages: false,
			} );
		}
	}, [ current, updateSettings ] );

	return null;
}
