import { createRoot } from '@wordpress/element';

import './index.scss';
// Register every block type before the shell can fetch a document. WP 7.1's
// core-data parses `content` when a full record arrives and caches the
// result; parsed with no block types registered, the cache holds an empty
// block list, the editor opens blank, and the next autosave erases the page.
// Sidebar lists such as Recents fetch full records before the lazy editor
// chunk loads. Upstream fix: WordPress/gutenberg#81809 (not in WP 7.1).
import './components/initEditor';

import { router, RouterProvider } from './router';

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
	// initiates; the setTimeout fallback covers browsers without it. A
	// rejected import here only fails the idle job, and the real lazy
	// import on first navigation will retry on its own.
	const warmEditor = () =>
		import( /* webpackChunkName: "editor" */ './components/Canvas' );
	if ( typeof window.requestIdleCallback === 'function' ) {
		window.requestIdleCallback( warmEditor, { timeout: 4000 } );
	} else {
		window.setTimeout( warmEditor, 200 );
	}
}
