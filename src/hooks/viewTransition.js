import { flushSync } from '@wordpress/element';

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		!! window.matchMedia &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

let activeTransition = null;

function supportsViewTransitions() {
	return (
		typeof document !== 'undefined' &&
		typeof document.startViewTransition === 'function'
	);
}

function canUseViewTransitions() {
	return supportsViewTransitions() && ! prefersReducedMotion();
}

// Wrap a state update so the browser snapshots the canvas before and
// after, then cross-fades between them. Without View Transitions support
// or with reduced motion on, just runs the updater directly.
export function withViewTransition( updater ) {
	if ( ! canUseViewTransitions() ) {
		updater();
		return;
	}

	const tx = document.startViewTransition( () => {
		flushSync( updater );
	} );
	activeTransition = tx;
	tx.finished
		.catch( () => {} )
		.finally( () => {
			if ( activeTransition === tx ) {
				activeTransition = null;
			}
		} );
}

// Resolves once the next view transition (started within `maxStartWait` ms
// of the call) has finished. Resolves immediately if none starts.
export function whenViewTransitionsSettled( maxStartWait = 1500 ) {
	if ( ! canUseViewTransitions() ) {
		return Promise.resolve();
	}

	return new Promise( ( resolve ) => {
		const startedAt =
			typeof performance !== 'undefined' ? performance.now() : Date.now();
		const check = () => {
			if ( activeTransition ) {
				activeTransition.finished.catch( () => {} ).finally( resolve );
				return;
			}
			const now =
				typeof performance !== 'undefined'
					? performance.now()
					: Date.now();
			if ( now - startedAt >= maxStartWait ) {
				resolve();
				return;
			}
			window.requestAnimationFrame( check );
		};
		check();
	} );
}
