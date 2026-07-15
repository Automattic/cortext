import { render, waitFor } from '@testing-library/react';

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
} );
