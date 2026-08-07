import { useEffect } from '@wordpress/element';

export const DOCUMENT_ARCHIVE_CHANGED_EVENT =
	'cortext:document-archive-changed';

export function notifyDocumentArchiveChanged( detail = {} ) {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent( DOCUMENT_ARCHIVE_CHANGED_EVENT, { detail } )
	);
}

export function useDocumentArchiveInvalidation( onInvalidate ) {
	useEffect( () => {
		if ( typeof window === 'undefined' ) {
			return undefined;
		}
		const listener = ( event ) => {
			onInvalidate?.( event.detail );
		};
		window.addEventListener( DOCUMENT_ARCHIVE_CHANGED_EVENT, listener );
		return () => {
			window.removeEventListener(
				DOCUMENT_ARCHIVE_CHANGED_EVENT,
				listener
			);
		};
	}, [ onInvalidate ] );
}
