/**
 * Render and prop-contract tests for `src/components/sidebar/DocumentRow.js`.
 *
 * `DocumentRow` replaces `PageRow` and `CollectionRow`. The document layer
 * decides whether a row behaves like a hierarchy node or a leaf, so the suite
 * covers both modes through this one component:
 *  - hierarchy: real chevron, recursive children, three drop zones,
 *    add-child button.
 *  - leaf: chevron placeholder, no children, two drop zones, no add-child.
 *
 * The `documents` module is mocked so tests can inspect actions and feature
 * resolution without mounting the full sidebar provider stack each time.
 */
import { fireEvent, render, screen } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';

const mockRename = jest.fn();
const mockDuplicate = jest.fn();
const mockTrash = jest.fn();

jest.mock( '../../../../src/documents', () => {
	const ReactLib = require( 'react' );
	return {
		__esModule: true,
		useDocumentActions: () => ( {
			rename: mockRename,
			duplicate: mockDuplicate,
			trash: mockTrash,
		} ),
		useDocumentRecord: ( record ) => {
			const isCollection = record?.type === 'crtxt_collection';
			return {
				kind: isCollection ? 'collection' : 'page',
				title:
					record?.title?.rendered?.trim() ||
					record?.title?.raw?.trim() ||
					'(untitled)',
				icon: ReactLib.createElement( 'span', {
					'data-testid': 'mock-icon',
				} ),
				features: {
					hierarchy: ! isCollection,
					canCreateChild: ! isCollection,
					hasOwnIcon: ! isCollection,
				},
			};
		},
	};
} );

import DocumentRow from '../../../../src/components/sidebar/DocumentRow';

function makePage( overrides = {} ) {
	return {
		id: 1,
		type: 'crtxt_page',
		title: { rendered: 'Hello', raw: 'Hello' },
		...overrides,
	};
}

function makeCollection( overrides = {} ) {
	return {
		id: 7,
		type: 'crtxt_collection',
		title: { rendered: 'Books', raw: 'Books' },
		...overrides,
	};
}

function baseProps( overrides = {} ) {
	return {
		record: makePage(),
		childNodes: [],
		depth: 0,
		expandedIds: new Set(),
		draggedId: null,
		activeDrop: null,
		isSelected: false,
		onSelect: jest.fn(),
		onToggleExpand: jest.fn(),
		onCreateChild: jest.fn(),
		isFavorite: false,
		isFavoriteDisabled: false,
		onToggleFavorite: jest.fn(),
		isHome: false,
		onSetHome: jest.fn(),
		isHomeUpdating: false,
		autoRenameId: null,
		onAutoRenameConsumed: jest.fn(),
		...overrides,
	};
}

function renderRow( overrides = {} ) {
	const props = baseProps( overrides );
	const utils = render(
		<DndContext>
			<ul>
				<DocumentRow { ...props } />
			</ul>
		</DndContext>
	);
	return { ...utils, props };
}

// Popover positioning can finish after a test has already unmounted. Jest
// then sees React's act warning during the next test and fails the suite.
// Ignore only that warning; every other console.error should still fail.
const originalError = console.error;
beforeEach( () => {
	mockRename.mockReset();
	mockDuplicate.mockReset();
	mockTrash.mockReset();
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

describe( 'DocumentRow (hierarchical mode)', () => {
	it( 'renders the record title', () => {
		const { container } = renderRow();
		expect(
			container.querySelector( '.cortext-sidebar__title' )
		).toHaveTextContent( 'Hello' );
	} );

	it( 'falls back to "(untitled)" when the title is blank', () => {
		const { container } = renderRow( {
			record: makePage( { title: { rendered: '', raw: '' } } ),
		} );
		expect(
			container.querySelector( '.cortext-sidebar__title' )
		).toHaveTextContent( '(untitled)' );
	} );

	it( 'exposes the depth on the wrapper so CSS can indent the row', () => {
		const { container } = renderRow( { depth: 3 } );
		const wrapper = container.querySelector(
			'.cortext-sidebar__row-wrapper'
		);
		expect( wrapper.style.getPropertyValue( '--cortext-depth' ) ).toBe(
			'3'
		);
	} );

	it( 'renders a chevron when the node has children', () => {
		const { container } = renderRow( {
			childNodes: [ { page: { id: 2 }, children: [] } ],
		} );
		expect(
			container.querySelector(
				'.cortext-sidebar__chevron:not(.cortext-sidebar__chevron--placeholder)'
			)
		).toBeTruthy();
	} );

	it( 'renders a chevron placeholder when the node has no children', () => {
		const { container } = renderRow();
		expect(
			container.querySelector( '.cortext-sidebar__chevron--placeholder' )
		).toBeTruthy();
	} );

	it( 'exposes three drop zones (before / inside / after)', () => {
		const { container } = renderRow();
		expect(
			container.querySelectorAll( '.cortext-sidebar__drop-zone' )
		).toHaveLength( 3 );
		expect(
			container.querySelector( '.cortext-sidebar__drop-zone--inside' )
		).toBeTruthy();
	} );

	it( 'renders an add-child button', () => {
		const { props } = renderRow();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Add a page inside Hello' } )
		);
		expect( props.onCreateChild ).toHaveBeenCalledWith( 1 );
	} );

	it( 'calls onSelect with the record when the title is clicked', () => {
		const { container, props } = renderRow();
		fireEvent.click( container.querySelector( '.cortext-sidebar__title' ) );
		expect( props.onSelect ).toHaveBeenCalledWith( props.record );
	} );

	it( 'adds is-selected when the predicate matches', () => {
		const { container } = renderRow( { isSelected: true } );
		expect(
			container.querySelector( '.cortext-sidebar__row' )
		).toHaveClass( 'is-selected' );
	} );

	it( 'adds is-dragging when draggedId matches', () => {
		const { container } = renderRow( { draggedId: 1 } );
		expect(
			container.querySelector( '.cortext-sidebar__row' )
		).toHaveClass( 'is-dragging' );
	} );

	it( 'adds is-drop-inside when activeDrop targets this row', () => {
		const { container } = renderRow( {
			activeDrop: { zone: 'inside', targetId: 1 },
		} );
		expect(
			container.querySelector( '.cortext-sidebar__row' )
		).toHaveClass( 'is-drop-inside' );
	} );

	it( 'enters rename mode and consumes autoRenameId when it matches', () => {
		const { container, props } = renderRow( { autoRenameId: 1 } );
		expect(
			container.querySelector( '.cortext-sidebar__rename input' )
		).toBeTruthy();
		expect( props.onAutoRenameConsumed ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'calls onSetHome with the record from the menu', () => {
		const { container, props } = renderRow();
		fireEvent.click( container.querySelector( '.cortext-sidebar__menu' ) );
		fireEvent.click(
			screen.getByRole( 'menuitem', { name: 'Set as home' } )
		);
		expect( props.onSetHome ).toHaveBeenCalledWith( props.record );
	} );

	it( 'calls onToggleFavorite with the record from the menu', () => {
		const { container, props } = renderRow();
		fireEvent.click( container.querySelector( '.cortext-sidebar__menu' ) );
		fireEvent.click(
			screen.getByRole( 'menuitem', { name: 'Add to favorites' } )
		);
		expect( props.onToggleFavorite ).toHaveBeenCalledWith( props.record );
		expect( props.onSelect ).not.toHaveBeenCalled();
	} );

	it( 'renders a remove-favorite action when the row is favorited', () => {
		const { container } = renderRow( { isFavorite: true } );
		fireEvent.click( container.querySelector( '.cortext-sidebar__menu' ) );
		expect(
			screen.getByRole( 'menuitem', {
				name: 'Remove from favorites',
			} )
		).toBeTruthy();
	} );

	it( 'invokes the document layer duplicate action from the menu', () => {
		const { container, props } = renderRow();
		fireEvent.click( container.querySelector( '.cortext-sidebar__menu' ) );
		fireEvent.click(
			screen.getByRole( 'menuitem', { name: 'Duplicate' } )
		);
		expect( mockDuplicate ).toHaveBeenCalledWith( props.record );
	} );

	it( 'invokes the document layer trash action from the menu', () => {
		const { container, props } = renderRow();
		fireEvent.click( container.querySelector( '.cortext-sidebar__menu' ) );
		fireEvent.click( screen.getByRole( 'menuitem', { name: 'Trash' } ) );
		expect( mockTrash ).toHaveBeenCalledWith( props.record );
	} );

	it( 'invokes the document layer rename action when the inline editor commits', () => {
		const { container, props } = renderRow( { autoRenameId: 1 } );
		const input = container.querySelector(
			'.cortext-sidebar__rename input'
		);
		fireEvent.change( input, { target: { value: 'Renamed' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( mockRename ).toHaveBeenCalledWith( props.record, 'Renamed' );
	} );

	it( 'cancels inline rename on Escape without calling rename', () => {
		const { container } = renderRow( { autoRenameId: 1 } );
		const input = container.querySelector(
			'.cortext-sidebar__rename input'
		);
		fireEvent.change( input, { target: { value: 'Renamed' } } );
		fireEvent.keyDown( input, { key: 'Escape' } );
		expect( mockRename ).not.toHaveBeenCalled();
		expect(
			container.querySelector( '.cortext-sidebar__rename input' )
		).toBeNull();
	} );

	it( 'renders child rows recursively for hierarchical records', () => {
		const child = makePage( {
			id: 2,
			title: { rendered: 'Child', raw: 'Child' },
		} );
		const { container } = renderRow( {
			childNodes: [ { page: child, children: [] } ],
			expandedIds: new Set( [ 1 ] ),
		} );
		// Two rows total: root + child.
		expect(
			container.querySelectorAll( '.cortext-sidebar__row' )
		).toHaveLength( 2 );
		expect( screen.getByText( 'Child' ) ).toBeInTheDocument();
	} );
} );

describe( 'DocumentRow (leaf mode)', () => {
	it( 'renders only the chevron placeholder', () => {
		const { container } = renderRow( { record: makeCollection() } );
		expect(
			container.querySelector( '.cortext-sidebar__chevron--placeholder' )
		).toBeTruthy();
		expect(
			container.querySelectorAll(
				'.cortext-sidebar__chevron:not(.cortext-sidebar__chevron--placeholder)'
			)
		).toHaveLength( 0 );
	} );

	it( 'exposes only before/after drop zones', () => {
		const { container } = renderRow( { record: makeCollection() } );
		expect(
			container.querySelectorAll( '.cortext-sidebar__drop-zone' )
		).toHaveLength( 2 );
		expect(
			container.querySelector( '.cortext-sidebar__drop-zone--inside' )
		).toBeNull();
		expect(
			container.querySelector( '.cortext-sidebar__drop-zone--before' )
		).toBeTruthy();
		expect(
			container.querySelector( '.cortext-sidebar__drop-zone--after' )
		).toBeTruthy();
	} );

	it( 'omits the add-child button', () => {
		const { container } = renderRow( { record: makeCollection() } );
		expect(
			container.querySelector( '.cortext-sidebar__add-child' )
		).toBeNull();
	} );

	it( 'uses the leaf-specific trash menu label', () => {
		const { container, props } = renderRow( {
			record: makeCollection(),
		} );
		fireEvent.click( container.querySelector( '.cortext-sidebar__menu' ) );
		fireEvent.click(
			screen.getByRole( 'menuitem', { name: 'Move to Trash' } )
		);
		expect( mockTrash ).toHaveBeenCalledWith( props.record );
	} );

	it( 'does not render child rows even when childNodes are passed', () => {
		// Leaves never render child branches. Ignore passed nodes so stale tree
		// data cannot show rows under a collection.
		const stray = makeCollection( {
			id: 8,
			title: { rendered: 'Stray', raw: 'Stray' },
		} );
		const { container } = renderRow( {
			record: makeCollection(),
			childNodes: [ { page: stray, children: [] } ],
			expandedIds: new Set( [ 7 ] ),
		} );
		expect(
			container.querySelectorAll( '.cortext-sidebar__row' )
		).toHaveLength( 1 );
		expect( screen.queryByText( 'Stray' ) ).toBeNull();
	} );

	it( 'enters rename mode when autoRenameId matches', () => {
		const { container, props } = renderRow( {
			record: makeCollection(),
			autoRenameId: 7,
		} );
		const input = container.querySelector(
			'.cortext-sidebar__rename input'
		);
		expect( input ).toBeTruthy();
		expect( input.value ).toBe( 'Books' );
		expect( props.onAutoRenameConsumed ).toHaveBeenCalled();

		fireEvent.change( input, { target: { value: 'Albums' } } );
		fireEvent.keyDown( input, { key: 'Enter' } );
		expect( mockRename ).toHaveBeenCalledWith( props.record, 'Albums' );
	} );
} );
