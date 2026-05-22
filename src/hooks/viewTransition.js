import { flushSync } from '@wordpress/element';

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		!! window.matchMedia &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

let activeTransition = null;

function setTransitionMode( mode ) {
	const root = document.documentElement;
	if ( mode ) {
		root.dataset.cortextViewTransition = mode;
		return;
	}
	delete root.dataset.cortextViewTransition;
}

function supportsViewTransitions() {
	return (
		typeof document !== 'undefined' &&
		typeof document.startViewTransition === 'function'
	);
}

function canUseViewTransitions() {
	return supportsViewTransitions() && ! prefersReducedMotion();
}

// Run the update inside the browser's View Transition snapshot window.
// Without the API, or when reduced motion is on, this is just a normal update.
// Callers can pass a mode when a swap needs its own CSS.
export function withViewTransition( updater, options = {} ) {
	if ( ! canUseViewTransitions() ) {
		updater();
		return;
	}

	setTransitionMode( options.mode );
	let tx;
	let updaterResult;
	try {
		tx = document.startViewTransition( () => {
			flushSync( () => {
				updaterResult = updater();
			} );
		} );
	} catch ( error ) {
		setTransitionMode( null );
		throw error;
	}
	activeTransition = tx;
	if (
		options.mode === 'hold-old-canvas' &&
		updaterResult &&
		typeof updaterResult.then === 'function'
	) {
		updaterResult
			.catch( () => {} )
			.finally( () => {
				tx.skipTransition?.();
			} );
	}
	tx.finished
		.catch( () => {} )
		.finally( () => {
			if ( activeTransition === tx ) {
				activeTransition = null;
				setTransitionMode( null );
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
