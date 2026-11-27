import { act, renderHook } from '@testing-library/react';

import useCollapsedTraitGroups, {
	COLLAPSED_TRAIT_GROUPS_KEY,
} from '../../../src/hooks/useCollapsedTraitGroups';

beforeEach( () => {
	window.localStorage.clear();
} );

describe( 'useCollapsedTraitGroups', () => {
	it( 'folds and unfolds a group and remembers it per collection', () => {
		const { result } = renderHook( () => useCollapsedTraitGroups() );

		expect( result.current.isCollapsed( 77 ) ).toBe( false );
		act( () => result.current.toggleCollapsed( 77 ) );
		expect( result.current.isCollapsed( 77 ) ).toBe( true );
		expect( result.current.isCollapsed( 88 ) ).toBe( false );
		expect(
			JSON.parse(
				window.localStorage.getItem( COLLAPSED_TRAIT_GROUPS_KEY )
			)
		).toEqual( [ 77 ] );

		act( () => result.current.toggleCollapsed( 77 ) );
		expect( result.current.isCollapsed( 77 ) ).toBe( false );
	} );

	it( 'restores the folded groups of an earlier session', () => {
		window.localStorage.setItem(
			COLLAPSED_TRAIT_GROUPS_KEY,
			JSON.stringify( [ 88 ] )
		);

		const { result } = renderHook( () => useCollapsedTraitGroups() );

		expect( result.current.isCollapsed( 88 ) ).toBe( true );
	} );

	it( 'ignores a malformed stored value', () => {
		window.localStorage.setItem( COLLAPSED_TRAIT_GROUPS_KEY, '{oops' );

		const { result } = renderHook( () => useCollapsedTraitGroups() );

		expect( result.current.isCollapsed( 88 ) ).toBe( false );
	} );
} );
