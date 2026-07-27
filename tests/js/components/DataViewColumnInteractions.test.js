import { fireEvent, render, waitFor } from '@testing-library/react';

import DataViewColumnInteractions from '../../../src/components/DataViewColumnInteractions';

function createTableWrapper() {
	const wrapper = document.createElement( 'div' );
	wrapper.innerHTML = `
		<table class="dataviews-view-table">
			<colgroup><col /></colgroup>
			<thead><tr><th>Field</th></tr></thead>
			<tbody>
				<tr><td>One</td></tr>
				<tr><td>Two</td></tr>
			</tbody>
		</table>
	`;
	document.body.appendChild( wrapper );
	return wrapper;
}

function firePointer( target, type, { pointerId, clientX, detail = 1 } ) {
	const event = new window.MouseEvent( type, {
		bubbles: true,
		button: 0,
		clientX,
		detail,
	} );
	Object.defineProperty( event, 'pointerId', { value: pointerId } );
	fireEvent( target, event );
}

afterEach( () => {
	document.body.innerHTML = '';
} );

describe( 'DataViewColumnInteractions', () => {
	it( 'clears imperative column widths when the persisted width is removed', async () => {
		const wrapper = createTableWrapper();
		const wrapperRef = { current: wrapper };
		const fields = [ { id: 'field-1', label: 'Field', type: 'text' } ];
		const view = {
			type: 'table',
			fields: [ 'field-1' ],
			layout: {
				styles: {
					'field-1': { width: 220 },
				},
			},
		};
		const { rerender } = render(
			<DataViewColumnInteractions
				wrapperRef={ wrapperRef }
				view={ view }
				fields={ fields }
				onChangeView={ jest.fn() }
			/>
		);
		const col = wrapper.querySelector( 'col' );
		const header = wrapper.querySelector( 'th' );
		const bodyCells = wrapper.querySelectorAll( 'td' );

		await waitFor( () => expect( col.style.width ).toBe( '220px' ) );
		expect( header.style.width ).toBe( '220px' );
		expect( header.style.maxWidth ).toBe( '220px' );
		for ( const cell of bodyCells ) {
			expect( cell.style.width ).toBe( '220px' );
			expect( cell.style.maxWidth ).toBe( '220px' );
		}

		// Live resizing may leave `width` or `maxWidth` on the column, header,
		// or cells.
		col.style.maxWidth = '220px';
		rerender(
			<DataViewColumnInteractions
				wrapperRef={ wrapperRef }
				view={ {
					...view,
					layout: { styles: {} },
				} }
				fields={ fields }
				onChangeView={ jest.fn() }
			/>
		);

		await waitFor( () => expect( col.style.width ).toBe( '' ) );
		expect( col.style.maxWidth ).toBe( '' );
		expect( header.style.width ).toBe( '' );
		expect( header.style.maxWidth ).toBe( '' );
		for ( const cell of bodyCells ) {
			expect( cell.style.width ).toBe( '' );
			expect( cell.style.maxWidth ).toBe( '' );
		}
	} );

	it( 'ignores resize events from unrelated pointers', async () => {
		const wrapper = createTableWrapper();
		const wrapperRef = { current: wrapper };
		const fields = [ { id: 'field-1', label: 'Field', type: 'text' } ];
		const view = {
			type: 'table',
			fields: [ 'field-1' ],
			layout: {
				styles: {
					'field-1': { width: 220 },
				},
			},
		};
		const onChangeView = jest.fn();

		render(
			<DataViewColumnInteractions
				wrapperRef={ wrapperRef }
				view={ view }
				fields={ fields }
				onChangeView={ onChangeView }
			/>
		);

		const header = wrapper.querySelector( 'th' );
		await waitFor( () => expect( header.style.width ).toBe( '220px' ) );
		const resizer = wrapper.querySelector( '.cortext-column-resizer' );

		firePointer( resizer, 'pointerdown', {
			pointerId: 1,
			clientX: 100,
		} );
		firePointer( document, 'pointermove', {
			pointerId: 2,
			clientX: 500,
		} );
		firePointer( document, 'pointerup', {
			pointerId: 2,
			clientX: 500,
		} );

		expect( header.style.width ).toBe( '220px' );
		expect( onChangeView ).not.toHaveBeenCalled();

		firePointer( document, 'pointermove', {
			pointerId: 1,
			clientX: 140,
		} );
		expect( header.style.width ).toBe( '260px' );

		firePointer( document, 'pointerup', {
			pointerId: 1,
			clientX: 140,
		} );
		expect( onChangeView ).toHaveBeenCalledTimes( 1 );
		expect(
			onChangeView.mock.calls[ 0 ][ 0 ].layout.styles[ 'field-1' ].width
		).toBe( 260 );
	} );
} );
