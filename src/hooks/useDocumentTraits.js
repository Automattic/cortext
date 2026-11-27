import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';

import { useDocumentLocatorInvalidation } from './documentLocatorInvalidation';

// Loads the collections a document belongs to from
// `GET /cortext/v1/documents/<id>/traits`. Returns the formatted
// `{ id, title, path, icon }` summaries the grouped properties and the
// membership chips render, plus `refresh` to re-pull on demand. Trait writes
// refresh it on their own.
//
// Reads go through this one endpoint rather than the row's `crtxt_trait` term
// ids so callers get collection ids and labels in a single round trip, and so a
// PUT to the same endpoint can refresh the exact shape it just wrote.
export default function useDocumentTraits( documentId ) {
	const [ state, setState ] = useState( {
		documentId: documentId ?? null,
		collections: [],
		isResolving: Boolean( documentId ),
		isInitialLoad: Boolean( documentId ),
		hasResolved: ! documentId,
		error: null,
	} );
	const requestIdRef = useRef( 0 );
	// The document whose memberships have already loaded or failed once. Until
	// then a request is the first load, not a refresh.
	const settledDocumentIdRef = useRef( null );

	const load = useCallback( () => {
		if ( ! documentId ) {
			requestIdRef.current += 1;
			setState( {
				documentId: null,
				collections: [],
				isResolving: false,
				isInitialLoad: false,
				hasResolved: true,
				error: null,
			} );
			return;
		}
		const requestId = ++requestIdRef.current;
		// Memberships are actionable: keeping the previous response visible
		// during a refresh lets a just-removed collection continue accepting
		// edits. Clear them until this request establishes the current set.
		setState( {
			documentId,
			collections: [],
			isResolving: true,
			isInitialLoad: settledDocumentIdRef.current !== documentId,
			hasResolved: false,
			error: null,
		} );
		apiFetch( {
			path: `/cortext/v1/documents/${ documentId }/traits`,
		} )
			.then( ( data ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				settledDocumentIdRef.current = documentId;
				setState( {
					documentId,
					collections: Array.isArray( data?.collections )
						? data.collections
						: [],
					isResolving: false,
					isInitialLoad: false,
					hasResolved: true,
					error: null,
				} );
			} )
			.catch( ( error ) => {
				if ( requestId !== requestIdRef.current ) {
					return;
				}
				settledDocumentIdRef.current = documentId;
				setState( {
					documentId,
					collections: [],
					isResolving: false,
					isInitialLoad: false,
					hasResolved: false,
					error,
				} );
			} );
	}, [ documentId ] );

	useEffect( () => {
		load();
	}, [ load ] );
	// Trait writes announce themselves through the locator event, wherever
	// they come from: the traits control or the `#` completer.
	useDocumentLocatorInvalidation( documentId, load );

	const isCurrentDocument = state.documentId === ( documentId ?? null );
	const isResolving = Boolean( documentId )
		? ! isCurrentDocument || state.isResolving
		: false;
	const hasResolved = isCurrentDocument && state.hasResolved;
	return {
		collections: isCurrentDocument ? state.collections : [],
		isResolving,
		// A request for a document that has not answered yet. A refresh after a
		// membership change is not one.
		isInitialLoad: isCurrentDocument
			? state.isInitialLoad
			: Boolean( documentId ),
		hasResolved,
		isUnknown: Boolean( documentId ) && ! hasResolved,
		error: isCurrentDocument ? state.error : null,
		refresh: load,
	};
}
