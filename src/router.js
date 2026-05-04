// Shell routes. The layout (Sidebar + main) is the root route; the index
// route renders the empty state; `$` is a splat that catches all sub-paths and
// hands the URI to EntityRoute for entity resolution.
//
// URLs are canonical: `/wp-admin/admin.php?page=cortext&p=/<app-path>`. The
// router emits those hrefs on navigation and parses them back on load.

import { privateApis as routePrivateApis } from '@wordpress/route';
import { SlotFillProvider } from '@wordpress/components';

import Sidebar from './components/Sidebar';
import WorkspaceTopBar from './components/WorkspaceTopBar';
import EntityRoute from './router/EntityRoute';
import { unlock } from './lock-unlock';

const {
	createRouter,
	createRootRoute,
	createRoute,
	createBrowserHistory,
	RouterProvider,
	parseHref,
} = unlock( routePrivateApis );

function RootLayout() {
	return (
		<SlotFillProvider>
			<div className="cortext-shell">
				<Sidebar />
				<main className="cortext-shell__canvas">
					<WorkspaceTopBar />
					<EntityRoute />
				</main>
			</div>
		</SlotFillProvider>
	);
}

const rootRoute = createRootRoute( { component: RootLayout } );

const indexRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '/',
} );

const splatRoute = createRoute( {
	getParentRoute: () => rootRoute,
	path: '$',
} );

const routeTree = rootRoute.addChildren( [ indexRoute, splatRoute ] );

const ADMIN_PATH = new URL(
	window.cortextSettings?.adminUrl ?? '/wp-admin/',
	window.location.origin
).pathname;
const MENU_SLUG = window.cortextSettings?.menuSlug ?? 'cortext';

function parseLocation() {
	const params = new URLSearchParams( window.location.search );
	const appPath = params.get( 'p' ) || '/';
	params.delete( 'page' );
	params.delete( 'p' );
	const rest = params.toString();
	const appHref = appPath + ( rest ? '?' + rest : '' ) + window.location.hash;
	return parseHref( appHref, window.history.state );
}

function createHref( appHref ) {
	const url = new URL( appHref, 'http://_app_/' );
	// `URLSearchParams.toString()` encodes slashes in `p`, which is ugly
	// but round-trips correctly via `URLSearchParams.get` on the next read.
	const params = new URLSearchParams( url.search );
	params.set( 'page', MENU_SLUG );
	params.set( 'p', url.pathname );
	return `${ ADMIN_PATH }admin.php?${ params.toString() }${ url.hash }`;
}

export const router = createRouter( {
	routeTree,
	history: createBrowserHistory( { parseLocation, createHref } ),
} );

export { RouterProvider };
