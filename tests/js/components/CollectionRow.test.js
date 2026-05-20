import { fireEvent, render, screen } from '@testing-library/react';

import CollectionRow, {
	collectionTitle,
} from '../../../src/components/CollectionRow';

// Popover positioning can finish after a test has already unmounted. Jest then
// sees React's act warning during the next test and fails the suite. Ignore
// only that warning; every other console.error should still fail.
const originalError = console.error;
beforeEach( () => {
	jest.spyOn( console, 'error' ).mockImplementation( ( ...args ) => {
		const first = args[ 0 ];
		if (
			typeof first === 'string' &&
			first.includes( 'inside a test was not wrapped in act' )
		) {
			return;
		}
		originalError( ...args );
	} );
} );

afterEach( () => {
	console.error.mockRestore?.();
} );

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

	it( 'shows Rename, Duplicate, and Move to Trash when callbacks are provided', () => {
		renderRow( {
			onRename: jest.fn(),
			onDuplicate: jest.fn(),
			onTrash: jest.fn(),
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Actions for Books' } )
		);

		expect(
			screen.getByRole( 'menuitem', { name: 'Rename' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'menuitem', { name: 'Duplicate' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'menuitem', { name: 'Move to Trash' } )
		).toBeInTheDocument();
	} );

	it( 'hides row actions when callbacks are missing', () => {
		// Inline collections and other stripped-down contexts leave these
		// callbacks unset, so the menu should leave those items out.
		renderRow();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Actions for Books' } )
		);

		expect(
			screen.queryByRole( 'menuitem', { name: 'Rename' } )
		).toBeNull();
		expect(
			screen.queryByRole( 'menuitem', { name: 'Duplicate' } )
		).toBeNull();
		expect(
			screen.queryByRole( 'menuitem', { name: 'Move to Trash' } )
		).toBeNull();
	} );

	it( 'opens rename mode from autoRenameId and commits on Enter', () => {
		// Exercise inline rename without opening the Popover. The auto-rename
		// path still uses the same editor as the Rename menu item.
		const onAutoRenameConsumed = jest.fn();
		const onRename = jest.fn();
		const { container } = renderRow( {
			autoRenameId: 7,
			onAutoRenameConsumed,
			onRename,
		} );

		const input = container.querySelector( '.cortext-sidebar__rename input' );
		expect( input ).toBeTruthy();
		expect( input.value ).toBe( 'Books' );
		expect( onAutoRenameConsumed ).toHaveBeenCalled();

		fireEvent.change( input, { target: { value: 'Albums' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );

		expect( onRename ).toHaveBeenCalledWith( 7, 'Albums' );
	} );

	it( 'cancels inline rename on Escape without calling onRename', () => {
		const onRename = jest.fn();
		const { container } = renderRow( {
			autoRenameId: 7,
			onAutoRenameConsumed: jest.fn(),
			onRename,
		} );

		const input = container.querySelector( '.cortext-sidebar__rename input' );
		fireEvent.change( input, { target: { value: 'Albums' } } );
		fireEvent.keyDown( input, { key: 'Escape' } );

		expect( onRename ).not.toHaveBeenCalled();
		expect(
			container.querySelector( '.cortext-sidebar__rename input' )
		).toBeNull();
	} );
} );
