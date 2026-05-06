// Shell routes. The layout (Sidebar + main) is the root route; the index
// route renders the empty state; `$` is a splat that catches all sub-paths and
// hands the URI to EntityRoute for entity resolution.
//
// URLs are canonical: `/wp-admin/admin.php?page=cortext&p=/<app-path>`. The
// router emits those hrefs on navigation and parses them back on load.

import { useEffect } from '@wordpress/element';
import { privateApis as routePrivateApis } from '@wordpress/route';
import { SlotFillProvider } from '@wordpress/components';

import Sidebar from './components/Sidebar';
import EntityRoute from './router/EntityRoute';
import CommandPalette from './components/CommandPalette';
import useSidebarLayout from './hooks/useSidebarLayout';
import { WorkspaceHomeProvider } from './hooks/useWorkspaceHome';
import { unlock } from './lock-unlock';

const {
	createRouter,
	createRootRoute,
	createRoute,
	createBrowserHistory,
	RouterProvider,
	parseHref,
} = unlock( routePrivateApis );

// Cmd/Ctrl+\ to toggle the sidebar. Cmd+B would clash with rich-text bold
// inside the editor iframe.
function isEditableTarget( target ) {
	if ( ! target ) {
		return false;
	}
	if ( target.tagName === 'IFRAME' ) {
		return true;
	}
	const tag = target.tagName;
	if ( tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ) {
		return true;
	}
	return target.isContentEditable === true;
}

function RootLayout() {
	const { collapsed, width, toggleCollapsed, setWidth } = useSidebarLayout();

	useEffect( () => {
		const onKeyDown = ( event ) => {
			if ( event.key !== '\\' || ! ( event.metaKey || event.ctrlKey ) ) {
				return;
			}
			if ( isEditableTarget( event.target ) ) {
				return;
			}
			event.preventDefault();
			toggleCollapsed();
		};
		window.addEventListener( 'keydown', onKeyDown );
		return () => window.removeEventListener( 'keydown', onKeyDown );
	}, [ toggleCollapsed ] );

	return (
		<SlotFillProvider>
			<WorkspaceHomeProvider>
				<div className="cortext-shell">
					<Sidebar
						collapsed={ collapsed }
						width={ width }
						onToggleCollapsed={ toggleCollapsed }
						onWidthChange={ setWidth }
					/>
					<main className="cortext-shell__canvas" tabIndex={ -1 }>
						<EntityRoute history={ router.history } />
					</main>
				</div>
				<CommandPalette />
			</WorkspaceHomeProvider>
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
