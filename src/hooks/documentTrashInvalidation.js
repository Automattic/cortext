import { useEffect } from '@wordpress/element';

export const DOCUMENT_TRASH_CHANGED_EVENT = 'cortext:document-trash-changed';

export function notifyDocumentTrashChanged() {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent( new CustomEvent( DOCUMENT_TRASH_CHANGED_EVENT ) );
}

export function useDocumentTrashInvalidation( onInvalidate ) {
	useEffect( () => {
		if ( typeof window === 'undefined' ) {
			return undefined;
		}
		const listener = () => {
			onInvalidate?.();
		};
		window.addEventListener( DOCUMENT_TRASH_CHANGED_EVENT, listener );
		return () => {
			window.removeEventListener(
				DOCUMENT_TRASH_CHANGED_EVENT,
				listener
			);
		};
	}, [ onInvalidate ] );
}
