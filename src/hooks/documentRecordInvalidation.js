import { useEffect } from '@wordpress/element';

export const DOCUMENT_RECORD_CHANGED_EVENT = 'cortext:document-record-changed';

export function notifyDocumentRecordChanged( detail = {} ) {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent( DOCUMENT_RECORD_CHANGED_EVENT, { detail } )
	);
}

export function useDocumentRecordInvalidation( onInvalidate ) {
	useEffect( () => {
		if ( typeof window === 'undefined' ) {
			return undefined;
		}
		const listener = ( event ) => {
			onInvalidate?.( event?.detail ?? {} );
		};
		window.addEventListener( DOCUMENT_RECORD_CHANGED_EVENT, listener );
		return () => {
			window.removeEventListener(
				DOCUMENT_RECORD_CHANGED_EVENT,
				listener
			);
		};
	}, [ onInvalidate ] );
}
