import { fireEvent, render, screen } from '@testing-library/react';

import CollectionRow, {
	collectionTitle,
} from '../../../src/components/CollectionRow';

function makeCollection( overrides = {} ) {
	return {
		id: 7,
		title: { rendered: 'Books', raw: 'Books' },
		...overrides,
	};
}

function baseProps( overrides = {} ) {
	return {
		collection: makeCollection(),
		isSelected: false,
		isFavorite: false,
		isHome: false,
		isHomeUpdating: false,
		onSelect: jest.fn(),
		onToggleFavorite: jest.fn(),
		onSetHome: jest.fn(),
		...overrides,
	};
}

function renderRow( overrides = {} ) {
	const props = baseProps( overrides );
	const utils = render(
		<ul>
			<CollectionRow { ...props } />
		</ul>
	);
	return { ...utils, props };
}

describe( 'CollectionRow', () => {
	it( 'resolves a collection title from rendered or raw values', () => {
		expect( collectionTitle( makeCollection() ) ).toBe( 'Books' );
		expect(
			collectionTitle(
				makeCollection( { title: { rendered: '', raw: 'Raw Books' } } )
			)
		).toBe( 'Raw Books' );
	} );

	it( 'calls onSelect when the title is clicked', () => {
		const { container, props } = renderRow();
		// dnd-kit gives the draggable wrapper button semantics, so there are
		// two "Books" buttons here. Click the title button directly.
		fireEvent.click( container.querySelector( '.cortext-sidebar__title' ) );

		expect( props.onSelect ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'calls onToggleFavorite from the action menu', () => {
		const { props } = renderRow();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Actions for Books' } )
		);
		fireEvent.click(
			screen.getByRole( 'menuitem', { name: 'Add to favorites' } )
		);

		expect( props.onToggleFavorite ).toHaveBeenCalledWith( 7 );
		expect( props.onSelect ).not.toHaveBeenCalled();
	} );

	it( 'renders a remove favorite action when the collection is favorited', () => {
		renderRow( { isFavorite: true } );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Actions for Books' } )
		);

		expect(
			screen.getByRole( 'menuitem', {
				name: 'Remove from favorites',
			} )
		).toBeTruthy();
	} );
} );
