import { useSelect, useDispatch } from '@wordpress/data';
import { store as blockEditorStore } from '@wordpress/block-editor';
import { store as editorStore } from '@wordpress/editor';
import { useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

import { fetchCortextLinkSuggestions } from './fetchCortextLinkSuggestions';

// Scopes the editor's link picker to Cortext documents.
//
// On the block-editor store it points `__experimentalFetchLinkSuggestions` at
// Cortext documents and controls the picker's "Create" action. With
// `allowCreate` (the full document editor), "Create" makes a new Cortext
// document as a child of the one being edited; otherwise it is hidden, so the
// picker never spawns a stray page.
//
// `@wordpress/editor`'s useBlockEditorSettings overwrites these settings on
// every recompute, so passing them through the editor settings never sticks.
// This component renders nothing: it lives inside EditorProvider and re-applies
// the settings when the live fetcher drifts (a recompute) or the edited
// document changes, so a created child still lands under the right parent.
export default function CortextLinkSuggestions( { allowCreate = false } ) {
	// Watched so we notice when Gutenberg swaps our fetcher back out: when this
	// changes, the effect re-runs and re-applies every override.
	const current = useSelect(
		( select ) =>
			select( blockEditorStore ).getSettings()
				.__experimentalFetchLinkSuggestions,
		[]
	);
	const parentId = useSelect(
		( select ) => select( editorStore ).getCurrentPostId(),
		[]
	);
	const { updateSettings } = useDispatch( blockEditorStore );

	useEffect( () => {
		const canCreate = allowCreate && !! parentId;
		updateSettings( {
			__experimentalFetchLinkSuggestions: fetchCortextLinkSuggestions,
			__experimentalUserCanCreatePages: canCreate,
			__experimentalCreatePageEntity: canCreate
				? ( { title, status = 'draft' } ) =>
						apiFetch( {
							path: '/wp/v2/crtxt_documents',
							method: 'POST',
							data: { title, status, parent: parentId },
						} )
				: undefined,
		} );
	}, [ current, allowCreate, parentId, updateSettings ] );

	return null;
}
