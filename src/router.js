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
	basepath: '/cortext',
} );

export { RouterProvider };
