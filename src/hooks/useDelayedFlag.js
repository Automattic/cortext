import { useEffect, useState } from '@wordpress/element';

/**
 * Returns true only after `active` has stayed true for `delayMs`, and resets
 * immediately when `active` clears.
 *
 * This keeps loading skeletons from flashing for work that finishes before the
 * user can register it. Under about 100 ms, showing nothing feels calmer than
 * showing one or two placeholder frames.
 *
 * @param {boolean} active  Whether the underlying condition (e.g. loading)
 *                          is currently true.
 * @param {number}  delayMs Milliseconds to wait before reflecting `active`.
 * @return {boolean} Whether `active` has stayed true for `delayMs`.
 */
export default function useDelayedFlag( active, delayMs = 120 ) {
	const [ delayed, setDelayed ] = useState( false );

	useEffect( () => {
		if ( ! active ) {
			setDelayed( false );
			return undefined;
		}
		const handle = setTimeout( () => setDelayed( true ), delayMs );
		return () => clearTimeout( handle );
	}, [ active, delayMs ] );

	return delayed;
}
