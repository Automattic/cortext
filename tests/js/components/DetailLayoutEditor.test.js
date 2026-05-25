import { act, fireEvent, render, screen, within } from '@testing-library/react';

let mockDndProps;

jest.mock( '@dnd-kit/core', () => {
	const { createElement } = require( '@wordpress/element' );

	return {
		__esModule: true,
		DndContext: ( props ) => {
			mockDndProps = props;
			return createElement(
				'div',
				{ 'data-testid': 'dnd-context' },
				props.children
			);
		},
		KeyboardSensor: jest.fn(),
		PointerSensor: jest.fn(),
		closestCenter: jest.fn(),
		useSensor: jest.fn( () => ( {} ) ),
		useSensors: jest.fn( ( ...sensors ) => sensors ),
	};
} );

jest.mock( '@dnd-kit/sortable', () => {
	const { createElement } = require( '@wordpress/element' );

	return {
		__esModule: true,
		SortableContext: ( props ) =>
			createElement(
				'div',
				{ 'data-testid': 'sortable-context' },
				props.children
			),
		arrayMove: ( items, from, to ) => {
			const next = [ ...items ];
			const [ item ] = next.splice( from, 1 );
			next.splice( to, 0, item );
			return next;
		},
		sortableKeyboardCoordinates: jest.fn(),
		useSortable: jest.fn( () => ( {
			attributes: {},
			listeners: {},
			setNodeRef: jest.fn(),
			transform: null,
			transition: undefined,
		} ) ),
		verticalListSortingStrategy: {},
	};
} );

import DetailLayoutEditor from '../../../src/components/DetailLayoutEditor';

const fields = [
	{ id: 'field-10', label: 'Author' },
	{ id: 'field-20', label: 'Year' },
	{ id: 'created_at', label: 'Created' },
];

const entries = [
	{ field: 'field-10', visible: true },
	{ field: 'field-20', visible: false },
	{ field: 'created_at', visible: true },
];

beforeEach( () => {
	mockDndProps = null;
} );

function rowFor( label ) {
	return screen
		.getByText( label )
		.closest( '.cortext-detail-layout-editor__row' );
}

describe( 'DetailLayoutEditor', () => {
	it( 'renders a sortable checklist with hidden rows preserved', () => {
		render(
			<DetailLayoutEditor
				entries={ entries }
				fields={ fields }
				onChange={ jest.fn() }
			/>
		);

		expect( screen.getByText( 'Author' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Year' ) ).toBeInTheDocument();
		expect( rowFor( 'Year' ) ).toHaveClass( 'is-hidden' );
		expect( screen.getByTestId( 'dnd-context' ) ).toBeInTheDocument();
	} );

	it( 'toggles visibility in the local draft', () => {
		const onChange = jest.fn();
		render(
			<DetailLayoutEditor
				entries={ entries }
				fields={ fields }
				onChange={ onChange }
			/>
		);

		fireEvent.click(
			within( rowFor( 'Author' ) ).getByRole( 'button', {
				name: 'Hide property',
			} )
		);

		expect( onChange ).toHaveBeenLastCalledWith( [
			{ field: 'field-10', visible: false },
			{ field: 'field-20', visible: false },
			{ field: 'created_at', visible: true },
		] );

		fireEvent.click(
			within( rowFor( 'Year' ) ).getByRole( 'button', {
				name: 'Show property',
			} )
		);

		expect( onChange ).toHaveBeenLastCalledWith( [
			{ field: 'field-10', visible: true },
			{ field: 'field-20', visible: true },
			{ field: 'created_at', visible: true },
		] );
	} );

	it( 'reorders entries after a drag ends over another field', () => {
		const onChange = jest.fn();
		render(
			<DetailLayoutEditor
				entries={ entries }
				fields={ fields }
				onChange={ onChange }
			/>
		);

		act( () => {
			mockDndProps.onDragEnd( {
				active: { id: 'created_at' },
				over: { id: 'field-10' },
			} );
		} );

		expect( onChange ).toHaveBeenCalledWith( [
			{ field: 'created_at', visible: true },
			{ field: 'field-10', visible: true },
			{ field: 'field-20', visible: false },
		] );
	} );
} );
