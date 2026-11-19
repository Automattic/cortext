/**
 * Tests for `src/components/trash/TrashView.js`, the canvas at `trash` before
 * an item is selected.
 */

import { render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Icon: () => null,
} ) );

jest.mock( '@wordpress/icons', () => ( {
	__esModule: true,
	trash: 'trash-icon',
} ) );

jest.mock( '../../../../src/hooks/useTrashedDocuments', () => ( {
	__esModule: true,
	default: () => mockTrashState,
} ) );

import TrashView from '../../../../src/components/trash/TrashView';

let mockTrashState;

function setTrash( documents, overrides = {} ) {
	mockTrashState = {
		documents,
		hasResolved: true,
		error: null,
		...overrides,
	};
}

describe( 'TrashView', () => {
	it( 'renders nothing while Trash is not showing', () => {
		setTrash( [] );
		const { container } = render( <TrashView isActive={ false } /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'says when Trash is empty and how long items stay', () => {
		setTrash( [] );
		render( <TrashView isActive /> );
		expect( screen.getByText( 'Nothing in Trash' ) ).toBeInTheDocument();
		expect(
			screen.getByText( /They stay for 30 days/ )
		).toBeInTheDocument();
	} );

	it( 'leaves the canvas to the selected document when Trash has items', () => {
		setTrash( [ { id: 1 } ] );
		const { container } = render( <TrashView isActive /> );
		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'waits for the list before saying anything', () => {
		setTrash( [], { hasResolved: false } );
		const { container } = render( <TrashView isActive /> );
		expect( container ).toBeEmptyDOMElement();
	} );
} );
