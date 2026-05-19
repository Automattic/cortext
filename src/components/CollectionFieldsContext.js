import { createContext, useContext, useMemo } from '@wordpress/element';

import useCollectionFields from '../hooks/useCollectionFields';

// Cortext's bulk-first data convention applies inside this context: column
// header actions, format popovers, and rename inputs read the field they
// operate on through `useMappedField` below instead of `useEntityRecord` by
// id. Bypassing the per-id resolver avoids a duplicate HTTP request for
// each column on every menu open (gutenberg#19153). See
// docs/architecture/shell.md for the wider convention.

// Keep one field-schema read per collection. `useCollectionFields` latches the
// last good field list, so sharing it here keeps the toolbar, inspector, table,
// and field menus in sync after field changes.
const CollectionFieldsContext = createContext( null );

export function CollectionFieldsProvider( { collectionId, children } ) {
	const { fields, collection, slug, isResolving, fieldsResolved } =
		useCollectionFields( collectionId );
	// `useCollectionFields` returns a fresh object each render. Memoize the
	// context value so consumers do not re-render when the pieces are unchanged.
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

// Returns the mapped field (with `cortextType`, `cortextElements`,
// `cortextFormat`, label, etc.) for a given crtxt_field record id, reading
// from the provider's bulk-loaded fields. Returns null if the recordId is
// not present in the active collection's field set.
export function useMappedField( recordId ) {
	const { fields } = useCollectionFieldsContext();
	return useMemo(
		() => fields.find( ( f ) => f.recordId === recordId ) ?? null,
		[ fields, recordId ]
	);
}
