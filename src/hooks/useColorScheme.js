import { useCallback, useEffect, useState } from '@wordpress/element';

const STORAGE_KEY = 'cortext.colorScheme';
const VALUES = [ 'auto', 'light', 'dark' ];

function resolveScheme( preference ) {
	if ( preference === 'light' || preference === 'dark' ) {
		return preference;
	}
	const mq =
		typeof window !== 'undefined' && window.matchMedia
			? window.matchMedia( '(prefers-color-scheme: dark)' )
			: null;
	return mq && mq.matches ? 'dark' : 'light';
}

function applyToRoot( resolved ) {
	const root = document.getElementById( 'cortext-root' );
	if ( root ) {
		root.setAttribute( 'data-theme', resolved );
	}
}

// Single source of truth for shell color scheme. The PHP bootstrap script
// (see Cortext\Theming\Preferences) stamps `data-theme` on the root before
// React mounts to avoid a flash; this hook takes over after mount and
// listens for system-preference changes while in 'auto'. Persistence is
// localStorage for phase 1 so we don't need a REST round-trip on load.
export default function useColorScheme() {
	const [ preference, setPreferenceState ] = useState( () => {
		const seeded = window.cortextBootstrap?.colorScheme;
		return VALUES.includes( seeded ) ? seeded : 'auto';
	} );
	const [ resolved, setResolved ] = useState( () =>
		resolveScheme( preference )
	);

	useEffect( () => {
		const next = resolveScheme( preference );
		setResolved( next );
		applyToRoot( next );

		if ( preference !== 'auto' || ! window.matchMedia ) {
			return undefined;
		}
		const mq = window.matchMedia( '(prefers-color-scheme: dark)' );
		const onChange = () => {
			const scheme = resolveScheme( 'auto' );
			setResolved( scheme );
			applyToRoot( scheme );
		};
		mq.addEventListener( 'change', onChange );
		return () => mq.removeEventListener( 'change', onChange );
	}, [ preference ] );

	const setPreference = useCallback( ( value ) => {
		if ( ! VALUES.includes( value ) ) {
			return;
		}
		setPreferenceState( value );
		try {
			window.localStorage.setItem( STORAGE_KEY, value );
		} catch {
			// Storage denied (private mode, quota); preference still applies
			// to this session.
		}
	}, [] );

	return {
		preference,
		resolved,
		setPreference,
	};
}
