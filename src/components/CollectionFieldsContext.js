import { createContext, useContext, useMemo } from '@wordpress/element';

import useCollectionFields from '../hooks/useCollectionFields';
import { toRecordId } from '../hooks/fieldIds';

// Field menus read from this context. The collection's field list is already
// loaded, and `useEntityRecord` would start a separate per-id core-data request.
// See docs/architecture/shell.md.

// Keep one field-schema read per collection. `useCollectionFields` latches the
// last good field list, so sharing it here keeps the toolbar, inspector, table,
// and field menus in sync after field changes.
const CollectionFieldsContext = createContext( null );

function fieldsByRecordIdFor( fields ) {
	const entries = ( fields ?? [] )
		.map( ( field ) => [
			field.recordId ?? field.cortextRecordId ?? toRecordId( field.id ),
			field,
		] )
		.filter( ( [ recordId ] ) => recordId );
	return new Map( entries );
}

export function CollectionFieldsProvider( { collectionId, children } ) {
	const {
		fields,
		detailFields,
		allDetailFields,
		detailLayoutEntries,
		collection,
		slug,
		isResolving,
		fieldsResolved,
	} = useCollectionFields( collectionId );
	// Index fields by record id once per update so `useMappedField` resolves
	// in constant time regardless of column count.
	const fieldsByRecordId = useMemo(
		() => fieldsByRecordIdFor( fields ),
		[ fields ]
	);
	// `useCollectionFields` returns a fresh object each render. Memoize the
	// context value so consumers do not re-render when the pieces are unchanged.
	const value = useMemo(
		() => ( {
			fields,
			detailFields,
			allDetailFields,
			detailLayoutEntries,
			fieldsByRecordId,
			collection,
			slug,
			isResolving,
			fieldsResolved,
		} ),
		[
			fields,
			detailFields,
			allDetailFields,
			detailLayoutEntries,
			fieldsByRecordId,
			collection,
			slug,
			isResolving,
			fieldsResolved,
		]
	);
	return (
		<CollectionFieldsContext.Provider value={ value }>
			{ children }
		</CollectionFieldsContext.Provider>
	);
}

export function CollectionFieldsSnapshotProvider( { fields, children } ) {
	const fieldsByRecordId = useMemo(
		() => fieldsByRecordIdFor( fields ),
		[ fields ]
	);
	const value = useMemo(
		() => ( {
			fields,
			fieldsByRecordId,
			collection: null,
			slug: null,
			isResolving: false,
			fieldsResolved: true,
		} ),
		[ fields, fieldsByRecordId ]
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

// Returns the mapped field for a crtxt_field record id, or null when that
// field is not part of the active collection.
export function useMappedField( recordId ) {
	const { fieldsByRecordId } = useCollectionFieldsContext();
	return fieldsByRecordId.get( recordId ) ?? null;
}
