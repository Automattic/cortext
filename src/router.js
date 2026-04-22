// Shell routes. The layout (Sidebar + main) is the root route; the index
// route renders the empty state; `$` is a splat that catches all sub-paths and
// hands the URI to EntityRoute for entity resolution.
//
// Memory history: the shell mounts at `wp-admin/admin.php?page=cortext`, a
// pathname browser-history can't usefully route against. Until Commit B adds
// the rewrite rule + ?p= adapter, in-app navigation lives in memory only —
// page reloads return to the empty state and browser back/forward navigates
// the wp-admin history, not the app's.

import {
	createRouter,
	createRootRoute,
	createRoute,
	createMemoryHistory,
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
	history: createMemoryHistory( { initialEntries: [ '/' ] } ),
} );

export { RouterProvider };
