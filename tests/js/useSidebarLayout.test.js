/**
 * Tests for `useSidebarLayout`: seeding from `window.cortextBootstrap`,
 * width clamping, localStorage persistence, and root-element stamping.
 */

import { act, renderHook } from '@testing-library/react';

import useSidebarLayout, {
	clampWidth,
	SIDEBAR_WIDTH_DEFAULT,
	SIDEBAR_WIDTH_MAX,
	SIDEBAR_WIDTH_MIN,
} from '../../src/hooks/useSidebarLayout';

function createRoot() {
	const root = document.createElement( 'div' );
	root.id = 'cortext-root';
	document.body.appendChild( root );
	return root;
}

beforeEach( () => {
	window.localStorage.clear();
	delete window.cortextBootstrap;
	document.body.innerHTML = '';
} );

describe( 'clampWidth', () => {
	it( 'returns the default when given a non-finite value', () => {
		expect( clampWidth( undefined ) ).toBe( SIDEBAR_WIDTH_DEFAULT );
		expect( clampWidth( NaN ) ).toBe( SIDEBAR_WIDTH_DEFAULT );
	} );

	it( 'clamps below the minimum', () => {
		expect( clampWidth( 100 ) ).toBe( SIDEBAR_WIDTH_MIN );
	} );

	it( 'clamps above the maximum', () => {
		expect( clampWidth( 9999 ) ).toBe( SIDEBAR_WIDTH_MAX );
	} );

	it( 'rounds in-range values', () => {
		expect( clampWidth( 300.7 ) ).toBe( 301 );
	} );
} );

describe( 'useSidebarLayout: seeding', () => {
	it( 'seeds collapsed=false and width=default when no bootstrap value', () => {
		createRoot();

		const { result } = renderHook( () => useSidebarLayout() );

		expect( result.current.collapsed ).toBe( false );
		expect( result.current.width ).toBe( SIDEBAR_WIDTH_DEFAULT );
	} );

	it( 'seeds from window.cortextBootstrap.sidebar', () => {
		createRoot();
		window.cortextBootstrap = {
			sidebar: { collapsed: true, width: 320 },
		};

		const { result } = renderHook( () => useSidebarLayout() );

		expect( result.current.collapsed ).toBe( true );
		expect( result.current.width ).toBe( 320 );
	} );

	it( 'clamps an out-of-range bootstrap width', () => {
		createRoot();
		window.cortextBootstrap = {
			sidebar: { collapsed: false, width: 9999 },
		};

		const { result } = renderHook( () => useSidebarLayout() );

		expect( result.current.width ).toBe( SIDEBAR_WIDTH_MAX );
	} );
} );

describe( 'useSidebarLayout: root stamping', () => {
	it( 'writes data-sidebar-collapsed and the CSS var on mount', () => {
		const root = createRoot();
		window.cortextBootstrap = {
			sidebar: { collapsed: true, width: 300 },
		};

		renderHook( () => useSidebarLayout() );

		expect( root.getAttribute( 'data-sidebar-collapsed' ) ).toBe( 'true' );
		expect( root.style.getPropertyValue( '--cortext-sidebar-width' ) ).toBe(
			'300px'
		);
	} );

	it( 'updates root attributes when state changes', () => {
		const root = createRoot();

		const { result } = renderHook( () => useSidebarLayout() );

		act( () => {
			result.current.setCollapsed( true );
		} );
		expect( root.getAttribute( 'data-sidebar-collapsed' ) ).toBe( 'true' );

		act( () => {
			result.current.setWidth( 360 );
		} );
		expect( root.style.getPropertyValue( '--cortext-sidebar-width' ) ).toBe(
			'360px'
		);
	} );
} );

describe( 'useSidebarLayout: persistence', () => {
	it( 'persists collapsed to localStorage', () => {
		createRoot();

		const { result } = renderHook( () => useSidebarLayout() );

		act( () => {
			result.current.setCollapsed( true );
		} );

		expect( window.localStorage.getItem( 'cortext.sidebarCollapsed' ) ).toBe(
			'true'
		);
	} );

	it( 'toggleCollapsed flips and persists', () => {
		createRoot();

		const { result } = renderHook( () => useSidebarLayout() );

		act( () => {
			result.current.toggleCollapsed();
		} );
		expect( result.current.collapsed ).toBe( true );
		expect( window.localStorage.getItem( 'cortext.sidebarCollapsed' ) ).toBe(
			'true'
		);

		act( () => {
			result.current.toggleCollapsed();
		} );
		expect( result.current.collapsed ).toBe( false );
		expect( window.localStorage.getItem( 'cortext.sidebarCollapsed' ) ).toBe(
			'false'
		);
	} );

	it( 'persists clamped width to localStorage', () => {
		createRoot();

		const { result } = renderHook( () => useSidebarLayout() );

		act( () => {
			result.current.setWidth( 9999 );
		} );

		expect( result.current.width ).toBe( SIDEBAR_WIDTH_MAX );
		expect( window.localStorage.getItem( 'cortext.sidebarWidth' ) ).toBe(
			String( SIDEBAR_WIDTH_MAX )
		);
	} );

	it( 'survives a localStorage write failure', () => {
		createRoot();
		const original = window.localStorage.setItem;
		window.localStorage.setItem = () => {
			throw new Error( 'quota' );
		};

		const { result } = renderHook( () => useSidebarLayout() );

		expect( () =>
			act( () => {
				result.current.setWidth( 320 );
			} )
		).not.toThrow();
		expect( result.current.width ).toBe( 320 );

		window.localStorage.setItem = original;
	} );
} );
