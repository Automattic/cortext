import { flushSync } from '@wordpress/element';

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		!! window.matchMedia &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

let activeTransition = null;
const HOLD_OLD_CANVAS_MODE = 'hold-old-canvas';
const REVEAL_OLD_CANVAS_MODE = 'reveal-old-canvas';

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
	let resolveUpdaterResult;
	const updaterResultReady = new Promise( ( resolve ) => {
		resolveUpdaterResult = resolve;
	} );
	try {
		tx = document.startViewTransition( () => {
			try {
				flushSync( () => {
					updaterResult = updater();
				} );
			} finally {
				resolveUpdaterResult( updaterResult );
			}
		} );
	} catch ( error ) {
		setTransitionMode( null );
		throw error;
	}
	activeTransition = tx;
	if ( options.mode === HOLD_OLD_CANVAS_MODE ) {
		// tech-debt.md#58: the View Transition callback can run after this
		// function returns, so wait for the updater result before revealing.
		const reveal = () => {
			if ( activeTransition === tx ) {
				setTransitionMode( REVEAL_OLD_CANVAS_MODE );
			}
		};
		updaterResultReady
			.then( ( result ) => {
				if ( result && typeof result.then === 'function' ) {
					return result.catch( () => {} );
				}
				return tx.ready.catch( () => {} );
			} )
			.finally( reveal );
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
