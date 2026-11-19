import { useEffect } from '@wordpress/element';

export const DOCUMENT_LOCATOR_CHANGED_EVENT =
	'cortext:document-locator-changed';

function normalizeDocumentId( documentId ) {
	const id = Number( documentId );
	return Number.isInteger( id ) && id > 0 ? id : null;
}

function normalizeTraitIds( traitIds ) {
	if ( ! Array.isArray( traitIds ) ) {
		return null;
	}
	return traitIds
		.map( normalizeDocumentId )
		.filter( ( id, index, all ) => id && all.indexOf( id ) === index );
}

// Custom REST writes bypass the resolver's local locator state. Publish the
// authoritative active memberships when the response contains them, then let
// the resolver revalidate the locator in the background.
export function notifyDocumentLocatorChanged( documentId, traitIds = null ) {
	if ( typeof window === 'undefined' ) {
		return;
	}
	const normalizedDocumentId = normalizeDocumentId( documentId );
	if ( ! normalizedDocumentId ) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent( DOCUMENT_LOCATOR_CHANGED_EVENT, {
			detail: {
				documentId: normalizedDocumentId,
				traitIds: normalizeTraitIds( traitIds ),
			},
		} )
	);
}

export function useDocumentLocatorInvalidation( documentId, onInvalidate ) {
	useEffect( () => {
		if ( typeof window === 'undefined' ) {
			return undefined;
		}
		const targetDocumentId = normalizeDocumentId( documentId );
		if ( ! targetDocumentId ) {
			return undefined;
		}

		const onLocatorChanged = ( event ) => {
			if (
				normalizeDocumentId( event?.detail?.documentId ) !==
				targetDocumentId
			) {
				return;
			}
			onInvalidate?.( {
				traitIds: normalizeTraitIds( event?.detail?.traitIds ),
			} );
		};

		window.addEventListener(
			DOCUMENT_LOCATOR_CHANGED_EVENT,
			onLocatorChanged
		);
		return () =>
			window.removeEventListener(
				DOCUMENT_LOCATOR_CHANGED_EVENT,
				onLocatorChanged
			);
	}, [ documentId, onInvalidate ] );
}
