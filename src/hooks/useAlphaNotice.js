import { useCallback, useState } from '@wordpress/element';

const STORAGE_KEY = 'cortext.alphaNoticeSeen';

function readSeen() {
	try {
		return window.localStorage.getItem( STORAGE_KEY ) === 'true';
	} catch {
		// Storage denied (private mode, quota). Treat as seen so we don't
		// nag on every load in environments where the choice can't persist.
		return true;
	}
}

export default function useAlphaNotice() {
	const [ isOpen, setOpen ] = useState( () => ! readSeen() );

	const acknowledge = useCallback( ( persist ) => {
		if ( persist ) {
			try {
				window.localStorage.setItem( STORAGE_KEY, 'true' );
			} catch {}
		}
		setOpen( false );
	}, [] );

	return { isOpen, acknowledge };
}
