import { render, waitFor, within } from '@testing-library/react';

jest.mock( '@wordpress/components', () => ( {
	Button: ( { children, ...props } ) => (
		<button type="button" { ...props }>
			{ children }
		</button>
	),
	Dropdown: ( { renderToggle } ) => (
		<div>{ renderToggle( { isOpen: false, onToggle: jest.fn() } ) }</div>
	),
} ) );

import TableCalculationsFooter from '../../../src/components/TableCalculationsFooter';

const field = {
	id: 'field-1',
	label: 'Pages',
	type: 'integer',
	cortextType: 'number',
	getValue: ( { item } ) => item.pages,
};

function tableWrapper() {
	const wrapper = document.createElement( 'div' );
	wrapper.innerHTML =
		'<table class="dataviews-view-table"><tbody></tbody></table>';
	document.body.appendChild( wrapper );
	return wrapper;
}

function renderFooter( props = {} ) {
	const wrapper = tableWrapper();
	render(
		<TableCalculationsFooter
			wrapperRef={ { current: wrapper } }
			view={ {
				fields: [ 'field-1' ],
				calculations: { 'field-1': 'sum' },
			} }
			fields={ [ field ] }
			data={ [ { pages: 1 }, { pages: 2 } ] }
			onChangeView={ jest.fn() }
			{ ...props }
		/>
	);
	return wrapper;
}

describe( 'TableCalculationsFooter', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	it( 'prefers matching server calculation results', async () => {
		const wrapper = renderFooter( {
			calculations: {
				'field-1': { calculation: 'sum', value: 30 },
			},
		} );

		await waitFor( () =>
			expect( within( wrapper ).getByText( '30' ) ).toBeInTheDocument()
		);
		expect( within( wrapper ).getByText( 'Sum' ) ).toBeInTheDocument();
	} );

	it( 'falls back to local row calculation when the server result is absent', async () => {
		const wrapper = renderFooter();

		await waitFor( () =>
			expect( within( wrapper ).getByText( '3' ) ).toBeInTheDocument()
		);
		expect( within( wrapper ).getByText( 'Sum' ) ).toBeInTheDocument();
	} );

	it( 'leaves the footer blank in server pagination until a matching total arrives', async () => {
		// These rows are only the current page. A local total would be wrong,
		// so the cell stays blank until the server result arrives.
		const wrapper = renderFooter( { isServerPaginated: true } );

		await waitFor( () =>
			expect( within( wrapper ).getByText( 'Sum' ) ).toBeInTheDocument()
		);
		expect( within( wrapper ).queryByText( '3' ) ).not.toBeInTheDocument();
	} );
} );
