import { fireEvent, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	...jest.requireActual( '@wordpress/core-data' ),
	useEntityRecords: jest.fn(),
} ) );

import { useEntityRecords } from '@wordpress/core-data';
import CollectionPicker from '../../../src/blocks/data-view/CollectionPicker';

function mockSearchResults( resultsBySearch ) {
	useEntityRecords.mockImplementation( ( kind, name, query ) => ( {
		records: resultsBySearch[ query.search ?? '' ] ?? [],
		isResolving: false,
		hasResolved: true,
	} ) );
}

beforeEach( () => {
	jest.clearAllMocks();
} );

describe( 'CollectionPicker', () => {
	it( 'passes the search to the collections query and lists what it returns', async () => {
		mockSearchResults( {
			'': [ { id: 1, title: { rendered: 'Clients' } } ],
			Archive: [ { id: 140, title: { rendered: 'Archive' } } ],
		} );
		const onSelect = jest.fn();
		render( <CollectionPicker onSelect={ onSelect } /> );

		expect(
			screen.queryByRole( 'button', { name: 'Archive' } )
		).toBeNull();

		fireEvent.change( screen.getByPlaceholderText( 'Search collections' ), {
			target: { value: 'Archive' },
		} );
		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Archive' } )
		);

		expect( onSelect ).toHaveBeenCalledWith( 140 );
		expect( useEntityRecords ).toHaveBeenLastCalledWith(
			'postType',
			'crtxt_document',
			expect.objectContaining( {
				search: 'Archive',
				_fields: 'id,title',
			} )
		);
	} );

	it( 'says when a search has no matches', async () => {
		mockSearchResults( {
			'': [ { id: 1, title: { rendered: 'Clients' } } ],
		} );
		render( <CollectionPicker onSelect={ jest.fn() } /> );

		fireEvent.change( screen.getByPlaceholderText( 'Search collections' ), {
			target: { value: 'Nope' },
		} );

		expect(
			await screen.findByText( 'No collections match your search.' )
		).toBeInTheDocument();
	} );

	it( 'says when there are no collections yet', () => {
		mockSearchResults( {} );
		render( <CollectionPicker onSelect={ jest.fn() } /> );

		expect( screen.getByText( 'No collections yet.' ) ).toBeInTheDocument();
	} );
} );
