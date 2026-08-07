import { act, renderHook } from '@testing-library/react';

import {
	SurfaceFocusProvider,
	useSurfaceFocusIntent,
} from '../../../src/components/SurfaceFocusContext';

function wrapper( { children } ) {
	return <SurfaceFocusProvider>{ children }</SurfaceFocusProvider>;
}

function activation( originElement, detail = 0 ) {
	return { currentTarget: originElement, detail };
}

describe( 'SurfaceFocusProvider', () => {
	it( 'creates a keyboard request and replaces the previous one', () => {
		const firstOrigin = document.createElement( 'button' );
		const secondOrigin = document.createElement( 'button' );
		const { result } = renderHook( () => useSurfaceFocusIntent(), {
			wrapper,
		} );

		let firstToken;
		act( () => {
			firstToken = result.current.requestFromActivation(
				activation( firstOrigin ),
				41
			);
		} );
		expect( result.current.request ).toEqual( {
			token: firstToken,
			documentId: 41,
			originElement: firstOrigin,
		} );

		let secondToken;
		act( () => {
			secondToken = result.current.requestFromActivation(
				activation( secondOrigin ),
				42
			);
		} );
		expect( secondToken ).toBeGreaterThan( firstToken );
		expect( result.current.request ).toEqual( {
			token: secondToken,
			documentId: 42,
			originElement: secondOrigin,
		} );
	} );

	it( 'cancels a pending request on pointer activation', () => {
		const origin = document.createElement( 'button' );
		const { result } = renderHook( () => useSurfaceFocusIntent(), {
			wrapper,
		} );

		act( () => {
			result.current.requestFromActivation( activation( origin ), 41 );
		} );
		act( () => {
			result.current.requestFromActivation( activation( origin, 1 ), 41 );
		} );

		expect( result.current.request ).toBeNull();
	} );

	it( 'consumes only the request with the current token', () => {
		const origin = document.createElement( 'button' );
		const { result } = renderHook( () => useSurfaceFocusIntent(), {
			wrapper,
		} );
		let firstToken;
		let secondToken;
		const onConsume = jest.fn();

		act( () => {
			firstToken = result.current.requestFromActivation(
				activation( origin ),
				41
			);
			secondToken = result.current.requestFromActivation(
				activation( origin ),
				42
			);
		} );

		act( () => {
			expect( result.current.consume( firstToken, onConsume ) ).toBe(
				false
			);
		} );
		expect( onConsume ).not.toHaveBeenCalled();
		expect( result.current.request?.token ).toBe( secondToken );

		act( () => {
			expect( result.current.consume( secondToken, onConsume ) ).toBe(
				true
			);
			expect( result.current.consume( secondToken, onConsume ) ).toBe(
				false
			);
		} );
		expect( onConsume ).toHaveBeenCalledTimes( 1 );
		expect( result.current.request ).toBeNull();
	} );

	it( 'cancels when focus leaves the activating control', () => {
		const origin = document.createElement( 'button' );
		const next = document.createElement( 'button' );
		document.body.append( origin, next );
		origin.focus();
		const { result } = renderHook( () => useSurfaceFocusIntent(), {
			wrapper,
		} );

		act( () => {
			result.current.requestFromActivation( activation( origin ), 41 );
		} );
		act( () => next.focus() );

		expect( result.current.request ).toBeNull();
		origin.remove();
		next.remove();
	} );

	it( 'cancels on pointer input even if focus stays put', () => {
		const origin = document.createElement( 'button' );
		const nonFocusableTarget = document.createElement( 'div' );
		document.body.append( origin, nonFocusableTarget );
		origin.focus();
		const { result } = renderHook( () => useSurfaceFocusIntent(), {
			wrapper,
		} );

		act( () => {
			result.current.requestFromActivation( activation( origin ), 41 );
		} );
		act( () => {
			nonFocusableTarget.dispatchEvent(
				new window.MouseEvent( 'pointerdown', { bubbles: true } )
			);
		} );

		expect( document.activeElement ).toBe( origin );
		expect( result.current.request ).toBeNull();
		origin.remove();
		nonFocusableTarget.remove();
	} );

	it( 'cancels on back or forward navigation', () => {
		const origin = document.createElement( 'button' );
		const { result } = renderHook( () => useSurfaceFocusIntent(), {
			wrapper,
		} );

		act( () => {
			result.current.requestFromActivation( activation( origin ), 41 );
		} );
		act( () =>
			window.dispatchEvent( new window.PopStateEvent( 'popstate' ) )
		);

		expect( result.current.request ).toBeNull();
	} );

	it( 'cancels when focus leaves the browser window', () => {
		const origin = document.createElement( 'button' );
		document.body.appendChild( origin );
		origin.focus();
		const { result } = renderHook( () => useSurfaceFocusIntent(), {
			wrapper,
		} );

		act( () => {
			result.current.requestFromActivation( activation( origin ), 41 );
		} );
		act( () => window.dispatchEvent( new window.FocusEvent( 'blur' ) ) );

		expect( document.activeElement ).toBe( origin );
		expect( result.current.request ).toBeNull();
		origin.remove();
	} );
} );
