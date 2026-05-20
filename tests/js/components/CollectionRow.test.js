import { fireEvent, render, screen } from '@testing-library/react';

import CollectionRow, {
	collectionTitle,
} from '../../../src/components/CollectionRow';

// `@wordpress/components`'s Popover schedules positioning work that flushes
// after the test body, so `@wordpress/jest-console` sees the resulting
// "update not wrapped in act" warning when the next test renders and turns
// it into a failure. The warning is benign here: each test renders a fresh
// component and the leak is from the prior render's unmount. Silence
// React's act warning specifically; let every other console.error still
// fail the suite.
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

	it( 'shows Rename, Duplicate, and Move to Trash when their callbacks are provided', () => {
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

	it( 'hides destructive actions when their callbacks are not provided', () => {
		// Inline collections (and other contexts that don't yet wire these
		// actions) render the menu without Rename/Duplicate/Move to Trash.
		// Confirm the menu skips items whose callback is undefined.
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

	it( 'auto-enters rename mode, commits on Enter, and consumes autoRenameId', () => {
		// Exercises the inline rename UX without going through the Popover
		// menu, which leaks act warnings into adjacent tests. The auto-rename
		// path is the same code that the Rename menu item triggers.
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
