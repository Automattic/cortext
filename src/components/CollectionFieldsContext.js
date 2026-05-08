import { createContext, useContext, useMemo } from '@wordpress/element';

import useCollectionFields from '../hooks/useCollectionFields';

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
