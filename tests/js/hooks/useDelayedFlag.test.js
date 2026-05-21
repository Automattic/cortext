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

	it( 'holds the flag for the minimum visible duration', () => {
		const { result, rerender } = renderHook(
			( { active } ) => useDelayedFlag( active, 120, 300 ),
			{ initialProps: { active: true } }
		);

		// Past the delay -> flag flips true, min-visible window starts.
		act( () => {
			jest.advanceTimersByTime( 120 );
		} );
		expect( result.current ).toBe( true );

		// active clears while we're still inside the min window.
		act( () => {
			jest.advanceTimersByTime( 100 );
		} );
		rerender( { active: false } );
		expect( result.current ).toBe( true );

		// Run out the rest of the min window -> flag clears.
		act( () => {
			jest.advanceTimersByTime( 199 );
		} );
		expect( result.current ).toBe( true );

		act( () => {
			jest.advanceTimersByTime( 1 );
		} );
		expect( result.current ).toBe( false );
	} );

	it( 'clears immediately once min-visible has elapsed', () => {
		const { result, rerender } = renderHook(
			( { active } ) => useDelayedFlag( active, 120, 300 ),
			{ initialProps: { active: true } }
		);

		act( () => {
			jest.advanceTimersByTime( 120 + 300 + 50 );
		} );
		expect( result.current ).toBe( true );

		rerender( { active: false } );
		expect( result.current ).toBe( false );
	} );
} );
