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
	// Mirror onto body so Popover portals (mounted on body, outside the
	// cortext-root subtree) can re-skin via `body[data-cortext-theme]`.
	if ( typeof document !== 'undefined' && document.body ) {
		document.body.setAttribute( 'data-cortext-theme', resolved );
	}
	// Stamp the canvas frame surface on html itself so the view-transition
	// pseudo (which lives on the html element and can't see vars scoped to
	// .cortext-root) has something to read for its background fill during
	// the cross-fade. Without this dark mode flashes black through the
	// transition's transparent midpoint.
	if ( typeof document !== 'undefined' && document.documentElement ) {
		document.documentElement.style.setProperty(
			'--cortext-canvas-frame-surface-root',
			resolved === 'dark' ? '#2a2a2a' : '#ffffff'
		);
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
