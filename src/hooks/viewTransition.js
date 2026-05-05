import { flushSync } from '@wordpress/element';

function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		!! window.matchMedia &&
		window.matchMedia( '(prefers-reduced-motion: reduce)' ).matches
	);
}

// Wrap a state update so the browser snapshots the canvas before and
// after, then cross-fades between them. Without View Transitions support
// or with reduced motion on, just runs the updater directly.
export function withViewTransition( updater ) {
	const supported =
		typeof document !== 'undefined' &&
		typeof document.startViewTransition === 'function';

	if ( ! supported || prefersReducedMotion() ) {
		updater();
		return;
	}

	document.startViewTransition( () => {
		flushSync( updater );
	} );
}
