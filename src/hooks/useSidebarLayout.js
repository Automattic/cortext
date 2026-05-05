import { useCallback, useEffect, useState } from '@wordpress/element';

const COLLAPSED_KEY = 'cortext.sidebarCollapsed';
const WIDTH_KEY = 'cortext.sidebarWidth';

export const SIDEBAR_WIDTH_DEFAULT = 280;
export const SIDEBAR_WIDTH_MIN = 220;
export const SIDEBAR_WIDTH_MAX = 480;
export const SIDEBAR_RESIZE_STEP = 16;

export function clampWidth( value ) {
	const n = Number( value );
	if ( ! Number.isFinite( n ) ) {
		return SIDEBAR_WIDTH_DEFAULT;
	}
	if ( n < SIDEBAR_WIDTH_MIN ) {
		return SIDEBAR_WIDTH_MIN;
	}
	if ( n > SIDEBAR_WIDTH_MAX ) {
		return SIDEBAR_WIDTH_MAX;
	}
	return Math.round( n );
}

function getRoot() {
	return typeof document === 'undefined'
		? null
		: document.getElementById( 'cortext-root' );
}

function applyToRoot( { collapsed, width } ) {
	const root = getRoot();
	if ( ! root ) {
		return;
	}
	root.setAttribute( 'data-sidebar-collapsed', collapsed ? 'true' : 'false' );
	root.style.setProperty( '--cortext-sidebar-width', `${ width }px` );
}

// Owns the collapsed flag + expanded width. Theming\Preferences stamps
// both values onto `#cortext-root` pre-mount so there's no width flash;
// this hook takes over once React is up. localStorage for now, same as
// useColorScheme.
export default function useSidebarLayout() {
	const [ collapsed, setCollapsedState ] = useState( () => {
		const seeded = window.cortextBootstrap?.sidebar?.collapsed;
		return seeded === true;
	} );
	const [ width, setWidthState ] = useState( () => {
		const seeded = window.cortextBootstrap?.sidebar?.width;
		return clampWidth( seeded ?? SIDEBAR_WIDTH_DEFAULT );
	} );

	useEffect( () => {
		applyToRoot( { collapsed, width } );
	}, [ collapsed, width ] );

	const setCollapsed = useCallback( ( value ) => {
		const next = Boolean( value );
		setCollapsedState( next );
		try {
			window.localStorage.setItem(
				COLLAPSED_KEY,
				next ? 'true' : 'false'
			);
		} catch {
			// Storage denied (private mode, quota); choice still applies
			// for this session.
		}
	}, [] );

	const toggleCollapsed = useCallback( () => {
		setCollapsedState( ( prev ) => {
			const next = ! prev;
			try {
				window.localStorage.setItem(
					COLLAPSED_KEY,
					next ? 'true' : 'false'
				);
			} catch {}
			return next;
		} );
	}, [] );

	const setWidth = useCallback( ( value ) => {
		const next = clampWidth( value );
		setWidthState( next );
		try {
			window.localStorage.setItem( WIDTH_KEY, String( next ) );
		} catch {}
	}, [] );

	return {
		collapsed,
		width,
		setCollapsed,
		toggleCollapsed,
		setWidth,
	};
}
