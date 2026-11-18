import { useEffect, useState } from '@wordpress/element';

/**
 * Tracks whether a CSS media query currently matches.
 *
 * @param {string} query Media query, e.g. `(max-width: 781px)`.
 * @return {boolean} Whether the query matches.
 */
export default function useMediaQuery( query ) {
	const readMatch = () =>
		typeof window !== 'undefined' &&
		typeof window.matchMedia === 'function' &&
		window.matchMedia( query ).matches;
	const [ matches, setMatches ] = useState( readMatch );

	useEffect( () => {
		if (
			typeof window === 'undefined' ||
			typeof window.matchMedia !== 'function'
		) {
			return undefined;
		}

		const mediaQuery = window.matchMedia( query );
		const update = () => setMatches( mediaQuery.matches );
		update();
		if ( typeof mediaQuery.addEventListener === 'function' ) {
			mediaQuery.addEventListener( 'change', update );
		} else {
			mediaQuery.addListener?.( update );
		}

		return () => {
			if ( typeof mediaQuery.removeEventListener === 'function' ) {
				mediaQuery.removeEventListener( 'change', update );
			} else {
				mediaQuery.removeListener?.( update );
			}
		};
	}, [ query ] );

	return matches;
}
