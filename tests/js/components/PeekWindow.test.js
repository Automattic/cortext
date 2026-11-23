/**
 * PeekWindow renders one open document as a side or center peek. These tests
 * cover the parts that used to come from the Modal component: Escape closes a
 * center peek, focus stays inside the window, and the exit animation hands
 * control back to the layer.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

import PeekWindow from '../../../src/components/PeekWindow';

function renderWindow( props = {} ) {
	const onRequestClose = jest.fn();
	const onExited = jest.fn();
	const view = render(
		<PeekWindow
			mode="side"
			openedAsCenter={ false }
			isClosing={ false }
			onRequestClose={ onRequestClose }
			onExited={ onExited }
			{ ...props }
		>
			<button type="button">Inside</button>
		</PeekWindow>
	);
	const peekWindow = view.container.querySelector(
		'.cortext-row-detail-sidebar-shell'
	);
	return { ...view, peekWindow, onRequestClose, onExited };
}

describe( 'PeekWindow', () => {
	it( 'shows the resize handle only as a side peek', () => {
		const { rerender, onRequestClose, onExited } = renderWindow();
		expect(
			screen.getByRole( 'separator', { name: 'Resize side peek' } )
		).toBeInTheDocument();

		rerender(
			<PeekWindow
				mode="modal"
				openedAsCenter={ false }
				isClosing={ false }
				onRequestClose={ onRequestClose }
				onExited={ onExited }
			>
				<button type="button">Inside</button>
			</PeekWindow>
		);

		expect(
			screen.queryByRole( 'separator', { name: 'Resize side peek' } )
		).not.toBeInTheDocument();
	} );

	it( 'closes a center peek on Escape', () => {
		const { onRequestClose } = renderWindow( { mode: 'modal' } );

		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Inside' } ), {
			key: 'Escape',
		} );

		expect( onRequestClose ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'leaves Escape alone in a side peek', () => {
		const { onRequestClose } = renderWindow();

		fireEvent.keyDown( screen.getByRole( 'button', { name: 'Inside' } ), {
			key: 'Escape',
		} );

		expect( onRequestClose ).not.toHaveBeenCalled();
	} );

	it( 'wraps focus at the edges of a center peek', () => {
		// jsdom has no layout, so report every element as visible.
		const getClientRects = jest
			.spyOn( window.Element.prototype, 'getClientRects' )
			.mockReturnValue( [ {} ] );
		const { container } = render(
			<PeekWindow
				mode="modal"
				openedAsCenter={ false }
				isClosing={ false }
				onRequestClose={ jest.fn() }
				onExited={ jest.fn() }
			>
				<button type="button">First</button>
				<button type="button">Last</button>
			</PeekWindow>
		);
		const [ start, end ] = container.querySelectorAll(
			'.cortext-row-detail-sidebar-shell__focus-sentinel'
		);

		act( () => end.focus() );
		expect( screen.getByRole( 'button', { name: 'First' } ) ).toHaveFocus();

		act( () => start.focus() );
		expect( screen.getByRole( 'button', { name: 'Last' } ) ).toHaveFocus();

		// Tab from the window itself goes to the first control.
		act( () => container.firstChild.focus() );
		act( () => start.focus() );
		expect( screen.getByRole( 'button', { name: 'First' } ) ).toHaveFocus();

		getClientRects.mockRestore();
	} );

	it( 'keeps the same content mounted when the mode changes', () => {
		const { rerender, onRequestClose, onExited } = renderWindow();
		const inside = screen.getByRole( 'button', { name: 'Inside' } );

		rerender(
			<PeekWindow
				mode="modal"
				openedAsCenter={ false }
				isClosing={ false }
				onRequestClose={ onRequestClose }
				onExited={ onExited }
			>
				<button type="button">Inside</button>
			</PeekWindow>
		);

		expect( screen.getByRole( 'button', { name: 'Inside' } ) ).toBe(
			inside
		);
	} );

	it( 'keeps focus in the window when the focused control disappears', () => {
		const { rerender, peekWindow, onRequestClose, onExited } =
			renderWindow();
		const inside = screen.getByRole( 'button', { name: 'Inside' } );
		act( () => inside.focus() );

		rerender(
			<PeekWindow
				mode="modal"
				openedAsCenter={ false }
				isClosing={ false }
				onRequestClose={ onRequestClose }
				onExited={ onExited }
			>
				<span>No buttons in this mode</span>
			</PeekWindow>
		);

		expect( peekWindow ).toHaveFocus();
	} );

	it( 'returns focus to the opener as soon as it starts closing', () => {
		const opener = document.createElement( 'button' );
		document.body.appendChild( opener );
		act( () => opener.focus() );
		const props = {
			mode: 'modal',
			openedAsCenter: false,
			onRequestClose: jest.fn(),
			onExited: jest.fn(),
		};
		const { rerender } = render(
			<PeekWindow { ...props } isClosing={ false }>
				<button type="button">Inside</button>
			</PeekWindow>
		);
		act( () => screen.getByRole( 'button', { name: 'Inside' } ).focus() );

		rerender(
			<PeekWindow { ...props } isClosing>
				<button type="button">Inside</button>
			</PeekWindow>
		);

		expect( opener ).toHaveFocus();
		opener.remove();
	} );

	it( 'returns focus to the new opener when it reopens while closing', () => {
		const first = document.createElement( 'button' );
		const second = document.createElement( 'button' );
		document.body.append( first, second );
		act( () => first.focus() );
		const props = {
			mode: 'side',
			openedAsCenter: false,
			onRequestClose: jest.fn(),
			onExited: jest.fn(),
		};
		const content = <button type="button">Inside</button>;
		const { rerender } = render(
			<PeekWindow { ...props } isClosing={ false }>
				{ content }
			</PeekWindow>
		);
		rerender(
			<PeekWindow { ...props } isClosing>
				{ content }
			</PeekWindow>
		);

		// Another row opens the peek before the exit animation ends.
		act( () => second.focus() );
		rerender(
			<PeekWindow { ...props } isClosing={ false }>
				{ content }
			</PeekWindow>
		);
		act( () => screen.getByRole( 'button', { name: 'Inside' } ).focus() );
		rerender(
			<PeekWindow { ...props } isClosing>
				{ content }
			</PeekWindow>
		);

		expect( second ).toHaveFocus();
		first.remove();
		second.remove();
	} );

	it( 'reports the end of its exit animation', () => {
		const { peekWindow, onExited } = renderWindow( { isClosing: true } );

		fireEvent.animationEnd( peekWindow );

		expect( onExited ).toHaveBeenCalledTimes( 1 );
	} );
} );
