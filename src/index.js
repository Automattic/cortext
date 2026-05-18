import { createRoot } from '@wordpress/element';

import { router, RouterProvider } from './router';
import './index.scss';

const root = document.getElementById( 'cortext-root' );
if ( root ) {
	window.cortextRouter = router;
	createRoot( root ).render( <RouterProvider router={ router } /> );

	// Warm the editor chunk in the background once the shell has painted.
	// Both Canvas and RowEditor resolve to the same `editor` chunk, so one
	// dynamic import primes both. Without it, the first document open or
	// row click on a fresh session pays the fetch cost and briefly shows
	// the Suspense fallback; with it, most navigations find the chunk
	// already in memory. requestIdleCallback yields to anything the user
	// initiates; the setTimeout fallback covers browsers without it.
	const warmEditor = () =>
		import(
			/* webpackChunkName: "editor" */
			'./components/Canvas'
		).catch( () => {
			// Network hiccup; the first real navigation will retry.
		} );
	if ( typeof window.requestIdleCallback === 'function' ) {
		window.requestIdleCallback( warmEditor, { timeout: 4000 } );
	} else {
		window.setTimeout( warmEditor, 200 );
	}
}
