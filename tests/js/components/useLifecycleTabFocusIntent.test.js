import { act, renderHook } from '@testing-library/react';

import useLifecycleTabFocusIntent from '../../../src/components/useLifecycleTabFocusIntent';

function dispatchClick( target, detail ) {
	target.dispatchEvent(
		new window.MouseEvent( 'click', { bubbles: true, detail } )
	);
}

function makeButton() {
	const button = document.createElement( 'button' );
	document.body.appendChild( button );
	return button;
}

describe( 'useLifecycleTabFocusIntent', () => {
	it( 'creates and consumes an intent for keyboard activation', () => {
		const origin = makeButton();
		origin.focus();
		const { result } = renderHook( () => useLifecycleTabFocusIntent() );
		let intent;

		act( () => {
			dispatchClick( origin, 0 );
			intent = result.current.capture( { id: 7 } );
		} );

		expect( intent ).toEqual(
			expect.objectContaining( {
				documentId: 7,
				originElement: origin,
			} )
		);
		expect( result.current.consume( intent ) ).toBe( true );
		expect( result.current.consume( intent ) ).toBe( false );
		origin.remove();
	} );

	it( 'does not create an intent for pointer activation', () => {
		const origin = makeButton();
		const { result } = renderHook( () => useLifecycleTabFocusIntent() );
		let intent;

		act( () => {
			dispatchClick( origin, 1 );
			intent = result.current.capture( { id: 7 } );
		} );

		expect( intent ).toBeNull();
		origin.remove();
	} );

	it( 'cancels when focus moves elsewhere while work is pending', async () => {
		const origin = makeButton();
		const next = makeButton();
		origin.focus();
		const { result } = renderHook( () => useLifecycleTabFocusIntent() );
		let intent;

		act( () => {
			dispatchClick( origin, 0 );
			intent = result.current.capture( { id: 7 } );
		} );
		await act( async () => Promise.resolve() );
		act( () => next.focus() );

		expect( result.current.consume( intent ) ).toBe( false );
		origin.remove();
		next.remove();
	} );

	it( 'allows menu focus to return to the activating document row', async () => {
		const menuItem = makeButton();
		const row = document.createElement( 'li' );
		row.setAttribute( 'data-cortext-document-id', '7' );
		const rowButton = document.createElement( 'button' );
		row.appendChild( rowButton );
		document.body.appendChild( row );
		menuItem.focus();
		const { result } = renderHook( () => useLifecycleTabFocusIntent() );
		let intent;

		act( () => {
			dispatchClick( menuItem, 0 );
			intent = result.current.capture( { id: 7 } );
		} );
		await act( async () => Promise.resolve() );
		act( () => rowButton.focus() );

		expect( result.current.consume( intent ) ).toBe( true );
		menuItem.remove();
		row.remove();
	} );

	it( 'cancels on pointer input even when focus stays put', async () => {
		const origin = makeButton();
		origin.focus();
		const { result } = renderHook( () => useLifecycleTabFocusIntent() );
		let intent;

		act( () => {
			dispatchClick( origin, 0 );
			intent = result.current.capture( { id: 7 } );
		} );
		await act( async () => Promise.resolve() );
		act( () => {
			document.body.dispatchEvent(
				new window.MouseEvent( 'pointerdown', { bubbles: true } )
			);
		} );

		expect( document.activeElement ).toBe( origin );
		expect( result.current.consume( intent ) ).toBe( false );
		origin.remove();
	} );
} );
