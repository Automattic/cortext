import { act, render, screen } from '@testing-library/react';

let mockDndProps;

jest.mock( '@wordpress/components', () => {
	const { createElement, forwardRef } = require( '@wordpress/element' );

	const Button = forwardRef( ( { children, ...props }, ref ) =>
		createElement( 'button', { ...props, ref, type: 'button' }, children )
	);
	Button.displayName = 'Button';

	return {
		__esModule: true,
		Button,
		CheckboxControl: () => createElement( 'input', { type: 'checkbox' } ),
		DateTimePicker: () => createElement( 'div', null ),
		Dropdown: () => createElement( 'div', null ),
		Icon: () => createElement( 'span', { 'data-testid': 'wp-icon' } ),
		Popover: ( { children } ) => createElement( 'div', null, children ),
	};
} );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: jest.fn(),
	useSelect: jest.fn(),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	store: 'editor-store',
} ) );

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
		sortableKeyboardCoordinates: jest.fn(),
		useSortable: jest.fn( () => ( {
			attributes: {},
			isDragging: false,
			listeners: {},
			setNodeRef: jest.fn(),
			transform: null,
			transition: undefined,
		} ) ),
		verticalListSortingStrategy: {},
	};
} );

jest.mock( '../../../src/components/fields/FieldActionsMenu', () => ( {
	__esModule: true,
	default: ( { triggerContent } ) => <span>{ triggerContent }</span>,
} ) );

jest.mock( '../../../src/components/EditableCell', () => {
	const { createContext } = require( '@wordpress/element' );

	return {
		__esModule: true,
		default: () => null,
		RowMutationContext: createContext( {} ),
		dateOnlyValue: ( value ) => value,
		formatDisplay: ( value, type, options = {} ) => {
			if ( type === 'number' && options.format?.style === 'currency' ) {
				return `$${ value }`;
			}
			return value ? String( value ) : '';
		},
	};
} );

import { useDispatch, useSelect } from '@wordpress/data';
import { RowMutationContext } from '../../../src/components/EditableCell';
import RowProperties from '../../../src/components/RowProperties';

describe( 'RowProperties', () => {
	beforeEach( () => {
		mockDndProps = null;
		useDispatch.mockReturnValue( { editPost: jest.fn() } );
		useSelect.mockReturnValue( {
			title: 'Current title',
			meta: { 'field-7': 'Open' },
			hydratedMeta: {},
		} );
	} );

	it( 'shows icons for collection and internal fields, but not title', () => {
		render(
			<RowProperties
				fields={ [
					{
						id: 'title',
						label: 'Title',
						cortextFieldType: 'title',
						editable: true,
					},
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						cortextRecordId: 7,
						editable: true,
					},
					{
						id: 'created_at',
						label: 'Created',
						cortextFieldType: 'datetime',
						editable: false,
						getValue: () => '2026-05-23T10:00:00',
					},
				] }
				row={ {} }
			/>
		);

		const statusLabel = screen
			.getByText( 'Status' )
			.closest( '.cortext-row-detail__property-label' );
		expect(
			statusLabel.querySelector(
				'.cortext-row-detail__property-type-icon[data-cortext-field-type="text"]'
			)
		).toBeInTheDocument();

		const createdLabel = screen
			.getByText( 'Created' )
			.closest( '.cortext-row-detail__property-label' );
		expect(
			createdLabel.querySelector(
				'.cortext-row-detail__property-type-icon[data-cortext-system-field="created_at"]'
			)
		).toBeInTheDocument();
		expect( screen.queryByText( 'Title' ) ).not.toBeInTheDocument();
	} );

	it( 'uses the label icon chip as a drag handle for layout order', () => {
		const onLayoutReorder = jest.fn();
		render(
			<RowProperties
				fields={ [
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						cortextRecordId: 7,
						editable: true,
					},
					{
						id: 'created_at',
						label: 'Created',
						cortextFieldType: 'datetime',
						editable: false,
						getValue: () => '2026-05-23T10:00:00',
					},
				] }
				onLayoutReorder={ onLayoutReorder }
				row={ {} }
			/>
		);

		expect(
			screen.getAllByRole( 'button', { name: 'Reorder property' } )
		).toHaveLength( 2 );
		expect( screen.getByTestId( 'dnd-context' ) ).toBeInTheDocument();

		act( () => {
			mockDndProps.onDragEnd( {
				active: { id: 'created_at' },
				over: { id: 'field-7' },
			} );
		} );

		expect( onLayoutReorder ).toHaveBeenCalledWith(
			'created_at',
			'field-7'
		);
	} );

	it( 'uses format overrides for number properties', () => {
		useSelect.mockReturnValue( {
			title: 'Current title',
			meta: { 'field-7': 42 },
			hydratedMeta: {},
		} );

		render(
			<RowMutationContext.Provider
				value={ {
					formatOverrides: {
						'field-7': { style: 'currency', currency: 'USD' },
					},
				} }
			>
				<RowProperties
					fields={ [
						{
							id: 'field-7',
							label: 'Score',
							cortextFieldType: 'number',
							cortextRecordId: 7,
							editable: true,
						},
					] }
					row={ {} }
				/>
			</RowMutationContext.Provider>
		);

		expect( screen.getByRole( 'textbox', { name: 'Score' } ) ).toHaveValue(
			'$42'
		);
	} );
} );
