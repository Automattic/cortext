import { useEffect, useState } from '@wordpress/element';

/**
 * Returns true only after `active` has stayed true for `delayMs`. Resets
 * to false immediately when `active` flips back to false.
 *
 * Used to keep loading skeletons from flickering in and out when the work
 * they cover completes faster than the eye can register. Below ~100 ms a
 * user reads the transition as "instant" and a skeleton appearing for a
 * couple of frames feels worse than nothing.
 *
 * @param {boolean} active  Whether the underlying condition (e.g. loading)
 *                          is currently true.
 * @param {number}  delayMs Milliseconds to wait before reflecting `active`.
 * @return {boolean} `active` after it has stayed true for `delayMs`.
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
