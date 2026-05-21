import { useEffect, useRef, useState } from '@wordpress/element';

// Skeletons that flash on and off in under ~250ms read as a glitch. Pair this
// with the 120ms delay (delay-then-min-duration) so a skeleton is either not
// shown at all, or visible long enough to register as a deliberate state.
export const SKELETON_MIN_VISIBLE_MS = 300;

/**
 * Returns true only after `active` has stayed true for `delayMs`, and keeps
 * it true for at least `minVisibleMs` once raised so the result does not
 * flicker on borderline-fast loads.
 *
 * @param {boolean} active       Whether the underlying condition (e.g. loading)
 *                               is currently true.
 * @param {number}  delayMs      Milliseconds to wait before reflecting `active`.
 * @param {number}  minVisibleMs Once the flag has flipped true, keep it true
 *                               for at least this many milliseconds. Defaults
 *                               to 0 (clear as soon as `active` clears).
 * @return {boolean} The eventually-true flag.
 */
export default function useDelayedFlag(
	active,
	delayMs = 120,
	minVisibleMs = 0
) {
	const [ visible, setVisible ] = useState( false );
	const shownAtRef = useRef( null );

	useEffect( () => {
		if ( active ) {
			if ( visible ) {
				return undefined;
			}
			const handle = setTimeout( () => {
				shownAtRef.current = Date.now();
				setVisible( true );
			}, delayMs );
			return () => clearTimeout( handle );
		}

		if ( ! visible ) {
			return undefined;
		}

		const elapsed = Date.now() - ( shownAtRef.current ?? 0 );
		const remaining = Math.max( 0, minVisibleMs - elapsed );
		if ( remaining === 0 ) {
			shownAtRef.current = null;
			setVisible( false );
			return undefined;
		}

		const handle = setTimeout( () => {
			shownAtRef.current = null;
			setVisible( false );
		}, remaining );
		return () => clearTimeout( handle );
	}, [ active, delayMs, minVisibleMs, visible ] );

	return visible;
}
