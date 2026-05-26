import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';

let mockDndProps;

const mockEditPost = jest.fn();
const mockRelationEditorProps = [];

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '@wordpress/components', () => {
	const { createElement, forwardRef } = require( '@wordpress/element' );

	const Button = forwardRef(
		( { children, isPressed, label, onClick, ...props }, ref ) =>
			createElement(
				'button',
				{
					...props,
					ref,
					type: 'button',
					'aria-label': label ?? props[ 'aria-label' ],
					onClick,
				},
				children ?? label
			)
	);
	Button.displayName = 'Button';

	return {
		__esModule: true,
		Button,
		CheckboxControl: ( { checked, onChange, ...props } ) =>
			createElement( 'input', {
				...props,
				type: 'checkbox',
				checked,
				onChange: ( event ) => onChange?.( event.target.checked ),
			} ),
		DateTimePicker: () => createElement( 'div', null ),
		Dropdown: ( { renderToggle, renderContent } ) =>
			createElement(
				'div',
				null,
				renderToggle?.( { isOpen: false, onToggle: jest.fn() } ),
				renderContent?.( { onClose: jest.fn() } )
			),
		Icon: () => createElement( 'span', { 'data-testid': 'wp-icon' } ),
		Notice: ( { children } ) => createElement( 'div', null, children ),
		Popover: ( { children } ) => createElement( 'div', null, children ),
		Spinner: () => createElement( 'div', null, 'Loading' ),
		TextControl: ( props ) => createElement( 'input', props ),
		VisuallyHidden: ( { children } ) =>
			createElement( 'span', null, children ),
		__experimentalNumberControl: ( props ) =>
			createElement( 'input', props ),
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
		useDroppable: jest.fn( () => ( {
			setNodeRef: jest.fn(),
		} ) ),
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
	default: ( { field, triggerContent } ) => (
		<span>
			{ triggerContent }
			{ field?.description ? (
				<button type="button">{ `About ${ field.label }` }</button>
			) : null }
		</span>
	),
} ) );

jest.mock( '../../../src/components/EditableCell', () => {
	const { createContext, createElement } = require( '@wordpress/element' );

	return {
		__esModule: true,
		default: () => null,
		RowMutationContext: createContext( {} ),
		dateOnlyValue: ( value ) => value,
		formatDisplay: ( value, type, options = {} ) => {
			if ( type === 'number' && options.format?.style === 'currency' ) {
				return `$${ value }`;
			}
			if ( type === 'number' && options.format?.display === 'rich' ) {
				return createElement(
					'span',
					{ 'data-testid': 'rich-number-display' },
					`Rich ${ value }`
				);
			}
			return value ? String( value ) : '';
		},
	};
} );

jest.mock( '../../../src/components/relations/RelationEditor', () => ( {
	__esModule: true,
	default: ( props ) => {
		mockRelationEditorProps.push( props );
		const titles = ( Array.isArray( props.value ) ? props.value : [] )
			.map(
				( ref ) => ref?.title?.raw || ref?.title?.rendered || ref?.id
			)
			.join( ', ' );
		return (
			<button type="button" onClick={ () => props.onSave( [ 456 ] ) }>
				{ titles || props.label }
			</button>
		);
	},
} ) );

import apiFetch from '@wordpress/api-fetch';
import { useDispatch, useSelect } from '@wordpress/data';
import { RowMutationContext } from '../../../src/components/EditableCell';
import RowProperties from '../../../src/components/RowProperties';
import { COLLECTION_ROWS_CHANGED_EVENT } from '../../../src/hooks/rowInvalidation';

describe( 'RowProperties', () => {
	beforeEach( () => {
		mockDndProps = null;
		apiFetch.mockReset();
		mockEditPost.mockReset();
		mockRelationEditorProps.length = 0;
		useDispatch.mockReturnValue( { editPost: mockEditPost } );
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

		const score = screen.getByRole( 'textbox', { name: 'Score' } );
		expect( score ).toHaveValue( '$42' );

		fireEvent.mouseDown( score );

		expect( score ).toHaveFocus();
		expect( score ).toHaveValue( '42' );
	} );

	it( 'shows rich number displays until the value is edited', () => {
		useSelect.mockReturnValue( {
			title: 'Current title',
			meta: { 'field-7': 42 },
			hydratedMeta: {},
		} );

		render(
			<RowMutationContext.Provider
				value={ {
					formatOverrides: {
						'field-7': { style: 'plain', display: 'rich' },
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

		const trigger = screen.getByRole( 'button', { name: 'Score' } );
		expect( screen.getByTestId( 'rich-number-display' ) ).toHaveTextContent(
			'Rich 42'
		);

		fireEvent.click( trigger );

		expect( screen.getByRole( 'textbox', { name: 'Score' } ) ).toHaveValue(
			'42'
		);
	} );

	it( 'shows field description help on row property labels', () => {
		render(
			<RowProperties
				fields={ [
					{
						id: 'field-7',
						label: 'Status',
						description: 'Pick the current workflow state.',
						cortextFieldType: 'text',
						cortextRecordId: 7,
						editable: true,
					},
				] }
				row={ {} }
			/>
		);

		expect(
			screen.getByRole( 'button', { name: 'About Status' } )
		).toBeInTheDocument();
	} );

	it( 'does not show whitespace-only field descriptions', () => {
		render(
			<RowProperties
				fields={ [
					{
						id: 'field-7',
						label: 'Status',
						description: '   ',
						cortextFieldType: 'text',
						cortextRecordId: 7,
						editable: true,
					},
				] }
				row={ {} }
			/>
		);

		expect(
			screen.queryByRole( 'button', { name: 'About Status' } )
		).not.toBeInTheDocument();
	} );

	it( 'saves relation edits through the row endpoint and updates the displayed chip', async () => {
		const refreshRows = jest.fn();
		const onRowsChanged = jest.fn();
		window.addEventListener( COLLECTION_ROWS_CHANGED_EVENT, onRowsChanged );
		apiFetch.mockResolvedValue( {
			id: 99,
			title: { raw: 'Source row', rendered: 'Source row' },
			meta: {
				'field-7': [
					{
						id: 456,
						title: { raw: 'Grace Hopper' },
					},
				],
			},
		} );
		useSelect.mockReturnValue( {
			title: 'Source row',
			meta: { 'field-7': [ '123' ] },
			hydratedMeta: {
				'field-7': [
					{
						id: 123,
						title: { raw: 'Ada Lovelace' },
					},
				],
			},
		} );

		render(
			<RowMutationContext.Provider value={ { refreshRows } }>
				<RowProperties
					collectionId={ 44 }
					row={ { id: 99 } }
					fields={ [
						{
							id: 'field-7',
							label: 'Assignee',
							cortextFieldType: 'relation',
							editable: true,
							relatedCollectionId: 55,
							relationMultiple: true,
						},
					] }
				/>
			</RowMutationContext.Provider>
		);

		expect(
			screen.getByRole( 'button', { name: 'Ada Lovelace' } )
		).toBeInTheDocument();
		expect( mockRelationEditorProps.at( -1 ) ).toEqual(
			expect.objectContaining( {
				defaultOpen: false,
				relation: { targetCollectionId: 55, multiple: true },
			} )
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Ada Lovelace' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/collections/44/rows/99',
				method: 'POST',
				data: {
					field: 'field-7',
					value: [ 456 ],
				},
			} )
		);
		await screen.findByRole( 'button', { name: 'Grace Hopper' } );
		expect( refreshRows ).toHaveBeenCalled();
		expect( onRowsChanged ).toHaveBeenCalledWith(
			expect.objectContaining( {
				detail: { collectionId: 44 },
			} )
		);
		expect( mockEditPost ).not.toHaveBeenCalled();

		window.removeEventListener(
			COLLECTION_ROWS_CHANGED_EVENT,
			onRowsChanged
		);
	} );

	it( 'uses the explicit row id to enable editable relations', () => {
		useSelect.mockReturnValue( {
			title: 'Source row',
			meta: { 'field-7': [ '123' ] },
			hydratedMeta: {
				'field-7': [
					{
						id: 123,
						title: { raw: 'Ada Lovelace' },
					},
				],
			},
		} );

		render(
			<RowProperties
				collectionId={ 44 }
				row={ {} }
				rowId={ 99 }
				fields={ [
					{
						id: 'field-7',
						label: 'Assignee',
						cortextFieldType: 'relation',
						editable: true,
						relatedCollectionId: 55,
						relationMultiple: true,
					},
				] }
			/>
		);

		expect( mockRelationEditorProps.at( -1 ) ).toEqual(
			expect.objectContaining( {
				relation: { targetCollectionId: 55, multiple: true },
			} )
		);
		expect(
			screen.getByRole( 'button', { name: 'Ada Lovelace' } )
		).toBeInTheDocument();
	} );

	it( 'separates hidden fields while editing the layout', () => {
		render(
			<RowProperties
				isLayoutEditing
				fields={ [
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						editable: true,
						cortextDetailVisible: true,
					},
					{
						id: 'field-8',
						label: 'Archived',
						cortextFieldType: 'text',
						editable: true,
						cortextDetailVisible: false,
					},
				] }
				row={ {} }
			/>
		);

		expect( screen.getByText( 'Hidden fields' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Status' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Archived' ) ).toBeInTheDocument();
	} );

	it( 'keeps a hidden fields drop zone while no fields are hidden', () => {
		render(
			<RowProperties
				isLayoutEditing
				fields={ [
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						editable: true,
						cortextDetailVisible: true,
					},
					{
						id: 'field-8',
						label: 'Owner',
						cortextFieldType: 'text',
						editable: true,
						cortextDetailVisible: true,
					},
				] }
				onLayoutReorder={ jest.fn() }
				row={ {} }
			/>
		);

		const separator = screen
			.getByText( 'Hidden fields' )
			.closest( '.cortext-row-detail__property-hidden-separator' );
		const dropzone = screen.getByLabelText( 'Hidden fields drop zone' );

		expect( separator ).toBeInTheDocument();
		expect( dropzone ).toHaveClass(
			'cortext-row-detail__property-hidden-dropzone'
		);
		expect( screen.getByText( 'Status' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Owner' ) ).toBeInTheDocument();
	} );
} );
