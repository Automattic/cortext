import { createContext, useContext, useMemo } from '@wordpress/element';

import useCollectionFields from '../hooks/useCollectionFields';

// Single subscription to a collection's field schema, shared across the
// data-view block (toolbar, inspector, table) and any column-level UI
// rendered beneath it. `useCollectionFields` keeps a per-instance latch so
// refetches don't flash spinners; routing every consumer through one
// provider means there is exactly one latch and consumers re-render
// together when a field is added, renamed, or deleted.
const CollectionFieldsContext = createContext( null );

export function CollectionFieldsProvider( { collectionId, children } ) {
	const { fields, collection, slug, isResolving, fieldsResolved } =
		useCollectionFields( collectionId );
	// `useCollectionFields` returns a fresh object literal each render;
	// memoizing on the destructured values keeps context identity stable
	// when nothing actually changed.
	const value = useMemo(
		() => ( { fields, collection, slug, isResolving, fieldsResolved } ),
		[ fields, collection, slug, isResolving, fieldsResolved ]
	);
	return (
		<CollectionFieldsContext.Provider value={ value }>
			{ children }
		</CollectionFieldsContext.Provider>
	);
}

export function useCollectionFieldsContext() {
	const ctx = useContext( CollectionFieldsContext );
	if ( ! ctx ) {
		throw new Error(
			'useCollectionFieldsContext: missing CollectionFieldsProvider'
		);
	}
	return ctx;
}
