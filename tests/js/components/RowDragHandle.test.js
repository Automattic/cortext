import { fireEvent, render, waitFor } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';

import RowDragHandle from '../../../src/components/RowDragHandle';

afterEach( () => {
	document.body.innerHTML = '';
	document.body.classList.remove(
		'cortext-row-dragging',
		'cortext-row-reorder-suppress-hover'
	);
} );

describe( 'RowDragHandle', () => {
	it( 'starts a keyboard drag from the focusable grid card', async () => {
		const grid = document.createElement( 'div' );
		const card = document.createElement( 'div' );
		const nextCard = document.createElement( 'div' );
		card.setAttribute( 'role', 'gridcell' );
		card.tabIndex = 0;
		card.textContent = 'One';
		nextCard.setAttribute( 'role', 'gridcell' );
		nextCard.tabIndex = -1;
		nextCard.textContent = 'Two';
		card.getBoundingClientRect = () => ( {
			top: 0,
			left: 0,
			right: 180,
			bottom: 220,
			width: 180,
			height: 220,
		} );
		grid.append( card, nextCard );
		document.body.appendChild( grid );
		const onGridKeyDown = jest.fn();
		grid.addEventListener( 'keydown', ( event ) => {
			onGridKeyDown( event );
			if ( event.code === 'ArrowRight' && ! event.defaultPrevented ) {
				nextCard.focus();
			}
		} );
		const onDragStart = jest.fn();
		const onDragMove = jest.fn();

		render(
			<DndContext onDragStart={ onDragStart } onDragMove={ onDragMove }>
				<RowDragHandle
					row={ {
						rowId: 1,
						label: 'One',
						el: card,
						handleEl: card,
					} }
					activateFromRow
					renderHandle={ false }
				/>
			</DndContext>
		);

		await waitFor( () =>
			expect( card ).toHaveAttribute(
				'aria-roledescription',
				'draggable item'
			)
		);
		expect( card ).toHaveAttribute( 'role', 'gridcell' );
		expect( card ).toHaveAttribute( 'tabindex', '0' );

		card.focus();
		fireEvent.keyDown( card, { code: 'ArrowRight' } );
		expect( onGridKeyDown ).toHaveBeenCalledTimes( 1 );
		expect( onDragStart ).not.toHaveBeenCalled();
		expect( document.activeElement ).toBe( nextCard );

		card.focus();
		fireEvent.keyDown( card, { code: 'Space' } );
		await waitFor( () => expect( onDragStart ).toHaveBeenCalledTimes( 1 ) );
		expect( onGridKeyDown ).toHaveBeenCalledTimes( 1 );
		expect( document.body ).toHaveClass(
			'cortext-row-reorder-suppress-hover'
		);

		fireEvent.keyDown( card, { code: 'ArrowRight' } );
		await waitFor( () => expect( onDragMove ).toHaveBeenCalled() );
		expect( document.activeElement ).toBe( card );
	} );
} );
