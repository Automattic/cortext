import { act, renderHook } from '@testing-library/react';

import useSidebarSections, {
	normalizeSidebarSectionsCollapsed,
	SIDEBAR_SECTION_DEFAULTS,
	SIDEBAR_SECTIONS_COLLAPSED_KEY,
} from '../../../src/hooks/useSidebarSections';

beforeEach( () => {
	window.localStorage.clear();
} );

describe( 'normalizeSidebarSectionsCollapsed', () => {
	it( 'defaults recents collapsed and durable sections expanded', () => {
		expect( normalizeSidebarSectionsCollapsed( null ) ).toEqual(
			SIDEBAR_SECTION_DEFAULTS
		);
		expect( normalizeSidebarSectionsCollapsed( '{ nope' ) ).toEqual(
			SIDEBAR_SECTION_DEFAULTS
		);
		expect( normalizeSidebarSectionsCollapsed( [] ) ).toEqual(
			SIDEBAR_SECTION_DEFAULTS
		);
	} );

	it( 'merges stored booleans over the defaults', () => {
		expect(
			normalizeSidebarSectionsCollapsed(
				JSON.stringify( {
					recents: false,
					favorites: true,
					pages: true,
					collections: 'yes',
					custom: true,
				} )
			)
		).toEqual( {
			...SIDEBAR_SECTION_DEFAULTS,
			recents: false,
			favorites: true,
			pages: true,
			custom: true,
		} );
	} );
} );

describe( 'useSidebarSections', () => {
	it( 'seeds from default section state', () => {
		const { result } = renderHook( () => useSidebarSections() );

		expect( result.current.isSectionCollapsed( 'recents' ) ).toBe( true );
		expect( result.current.isSectionCollapsed( 'favorites' ) ).toBe(
			false
		);
		expect( result.current.isSectionCollapsed( 'pages' ) ).toBe( false );
		expect( result.current.isSectionCollapsed( 'collections' ) ).toBe(
			false
		);
	} );

	it( 'seeds from localStorage with missing keys filled from defaults', () => {
		window.localStorage.setItem(
			SIDEBAR_SECTIONS_COLLAPSED_KEY,
			JSON.stringify( { pages: true } )
		);

		const { result } = renderHook( () => useSidebarSections() );

		expect( result.current.isSectionCollapsed( 'pages' ) ).toBe( true );
		expect( result.current.isSectionCollapsed( 'recents' ) ).toBe( true );
		expect( result.current.isSectionCollapsed( 'collections' ) ).toBe(
			false
		);
	} );

	it( 'toggles a section and persists the merged state', () => {
		const { result } = renderHook( () => useSidebarSections() );

		act( () => {
			result.current.toggleSection( 'pages' );
		} );

		expect( result.current.isSectionCollapsed( 'pages' ) ).toBe( true );
		expect(
			JSON.parse(
				window.localStorage.getItem( SIDEBAR_SECTIONS_COLLAPSED_KEY )
			)
		).toMatchObject( {
			recents: true,
			favorites: false,
			pages: true,
		} );
	} );

	it( 'sets a section explicitly', () => {
		const { result } = renderHook( () => useSidebarSections() );

		act( () => {
			result.current.setSectionCollapsed( 'favorites', true );
		} );

		expect( result.current.isSectionCollapsed( 'favorites' ) ).toBe( true );
	} );

	it( 'survives a localStorage write failure', () => {
		const original = window.localStorage.setItem;
		window.localStorage.setItem = () => {
			throw new Error( 'quota' );
		};

		const { result } = renderHook( () => useSidebarSections() );

		expect( () =>
			act( () => {
				result.current.toggleSection( 'pages' );
			} )
		).not.toThrow();
		expect( result.current.isSectionCollapsed( 'pages' ) ).toBe( true );

		window.localStorage.setItem = original;
	} );
} );
