import { act, renderHook } from '@testing-library/react';

import useDelayedFlag from '../../../src/hooks/useDelayedFlag';

beforeEach( () => {
	jest.useFakeTimers();
} );

afterEach( () => {
	jest.useRealTimers();
} );

describe( 'useDelayedFlag', () => {
	it( 'waits out the delay before returning true', () => {
		const { result } = renderHook( () => useDelayedFlag( true, 120 ) );

		expect( result.current ).toBe( false );

		act( () => {
			jest.advanceTimersByTime( 119 );
		} );
		expect( result.current ).toBe( false );

		act( () => {
			jest.advanceTimersByTime( 1 );
		} );
		expect( result.current ).toBe( true );
	} );

	it( 'stays false if active clears before the delay', () => {
		const { result, rerender } = renderHook(
			( { active } ) => useDelayedFlag( active, 120 ),
			{ initialProps: { active: true } }
		);

		act( () => {
			jest.advanceTimersByTime( 80 );
		} );
		expect( result.current ).toBe( false );

		rerender( { active: false } );
		act( () => {
			jest.advanceTimersByTime( 200 );
		} );
		expect( result.current ).toBe( false );
	} );

	it( 'goes false immediately when active clears', () => {
		const { result, rerender } = renderHook(
			( { active } ) => useDelayedFlag( active, 120 ),
			{ initialProps: { active: true } }
		);

		act( () => {
			jest.advanceTimersByTime( 200 );
		} );
		expect( result.current ).toBe( true );

		rerender( { active: false } );
		expect( result.current ).toBe( false );
	} );
} );
