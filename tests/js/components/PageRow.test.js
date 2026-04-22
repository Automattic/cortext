/**
 * Render + props-contract tests for `src/components/PageRow.js`:
 * title rendering, depth indentation, chevron/placeholder, selection and
 * drag/drop CSS class wiring, title-click selection, and the auto-rename
 * flow triggered by `autoRenameId`. DnD interaction itself is not simulated —
 * `PageRow` is wrapped in a `DndContext` only so `useDraggable`/`useDroppable`
 * don't throw.
 */

import { render, fireEvent } from '@testing-library/react';
import { DndContext } from '@dnd-kit/core';

import PageRow from '../../../src/components/PageRow';

function makeNode( overrides = {} ) {
	const { page = {}, children = [] } = overrides;
	return {
		page: {
			id: 1,
			title: { rendered: 'Hello', raw: 'Hello' },
			...page,
		},
		children,
	};
}

function baseProps( overrides = {} ) {
	return {
		node: makeNode(),
		depth: 0,
		selectedId: null,
		expandedIds: new Set(),
		draggedId: null,
		activeDrop: null,
		onSelect: jest.fn(),
		onToggleExpand: jest.fn(),
		onCreateChild: jest.fn(),
		onRename: jest.fn(),
		onDuplicate: jest.fn(),
		onDelete: jest.fn(),
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
				<PageRow { ...props } />
			</ul>
		</DndContext>
	);
	return { ...utils, props };
}

describe( 'PageRow', () => {
	it( 'renders the page title', () => {
		const { container } = renderRow();
		expect(
			container.querySelector( '.cortext-sidebar__title' )
		).toHaveTextContent( 'Hello' );
	} );

	it( 'falls back to "(untitled)" when the title is blank', () => {
		const { container } = renderRow( {
			node: makeNode( { page: { title: { rendered: '', raw: '' } } } ),
		} );
		expect(
			container.querySelector( '.cortext-sidebar__title' )
		).toHaveTextContent( '(untitled)' );
	} );

	it( 'sets padding-inline-start based on depth (20px grid unit)', () => {
		const { container } = renderRow( { depth: 3 } );
		const row = container.querySelector( '.cortext-sidebar__row' );
		expect( row ).toHaveStyle( { paddingInlineStart: '60px' } );
	} );

	it( 'renders a chevron when the node has children', () => {
		const { container } = renderRow( {
			node: makeNode( {
				children: [ { page: { id: 2 }, children: [] } ],
			} ),
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

	it( 'calls onSelect with the page id when the title is clicked', () => {
		const { container, props } = renderRow();
		fireEvent.click( container.querySelector( '.cortext-sidebar__title' ) );
		expect( props.onSelect ).toHaveBeenCalledWith( 1 );
	} );

	it( 'adds is-selected when selectedId matches', () => {
		const { container } = renderRow( { selectedId: 1 } );
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
} );
