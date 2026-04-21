// Shell routes. `basepath` matches the PHP-side Shell::ROUTE_PREFIX rewrite —
// injected through window.cortextSettings so JS has a single source of truth
// for the URL prefix. The layout (Sidebar + main) is the root route; the index
// route renders the empty state; `$` is a splat that catches all sub-paths and
// hands the URI to EntityRoute for entity resolution.

import {
	createRouter,
	createRootRoute,
	createRoute,
	Outlet,
	RouterProvider,
} from '@tanstack/react-router';

import Sidebar from './components/Sidebar';
import EntityRoute from './router/EntityRoute';
import EmptyState from './router/EmptyState';

function RootLayout() {
	return (
		<div className="cortext-shell">
			<Sidebar />
			<main className="cortext-shell__canvas">
				<Outlet />
			</main>
		</div>
	);
}

const rootRoute = createRootRoute( { component: RootLayout } );

const indexRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/',
	component: EmptyState,
} );

const splatRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '$',
	component: EntityRoute,
} );

const routeTree = rootRoute.addChildren( [ indexRoute, splatRoute ] );

export const router = createRouter( {
	routeTree,
	basepath: '/' + ( window.cortextSettings?.routePrefix ?? 'cortext' ),
} );

export { RouterProvider };
