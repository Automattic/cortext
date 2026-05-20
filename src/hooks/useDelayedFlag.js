import { useEffect, useState } from '@wordpress/element';

/**
 * Returns true only after `active` has stayed true for `delayMs`. Returns to
 * false as soon as `active` does.
 *
 * This keeps loading skeletons from flickering when the covered work finishes
 * faster than a person can really notice. Under roughly 100 ms, a couple of
 * skeleton frames feel worse than showing nothing.
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
