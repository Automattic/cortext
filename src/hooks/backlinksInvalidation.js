import { useEffect } from '@wordpress/element';

export const BACKLINKS_CHANGED_EVENT = 'cortext:backlinks-changed';

export function notifyBacklinksChanged() {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent( new CustomEvent( BACKLINKS_CHANGED_EVENT ) );
}

export function useBacklinksInvalidation( onInvalidate ) {
	useEffect( () => {
		if ( typeof window === 'undefined' ) {
			return undefined;
		}
		const listener = () => {
			onInvalidate?.();
		};
		window.addEventListener( BACKLINKS_CHANGED_EVENT, listener );
		return () => {
			window.removeEventListener( BACKLINKS_CHANGED_EVENT, listener );
		};
	}, [ onInvalidate ] );
}
