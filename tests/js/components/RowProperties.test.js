import {
	act,
	createEvent,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';

let mockDndProps;
let mockSortableContextProps;

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
		DragOverlay: ( props ) =>
			createElement(
				'div',
				{ 'data-testid': 'drag-overlay' },
				props.children
			),
		KeyboardSensor: jest.fn(),
		PointerSensor: jest.fn(),
		closestCenter: jest.fn(),
		pointerWithin: jest.fn(),
		useSensor: jest.fn( () => ( {} ) ),
		useSensors: jest.fn( ( ...sensors ) => sensors ),
		useDroppable: jest.fn( () => ( {
			isOver: false,
			setNodeRef: jest.fn(),
		} ) ),
	};
} );

jest.mock( '@dnd-kit/sortable', () => {
	const { createElement } = require( '@wordpress/element' );

	return {
		__esModule: true,
		SortableContext: ( props ) =>
			( mockSortableContextProps = props ) &&
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
import { closestCenter, pointerWithin, useDroppable } from '@dnd-kit/core';
import { useSortable } from '@dnd-kit/sortable';
import { RowMutationContext } from '../../../src/components/EditableCell';
import RowProperties, {
	HIDDEN_PROPERTIES_DROP_TARGET,
} from '../../../src/components/RowProperties';
import { COLLECTION_ROWS_CHANGED_EVENT } from '../../../src/hooks/rowInvalidation';

describe( 'RowProperties', () => {
	beforeEach( () => {
		mockDndProps = null;
		mockSortableContextProps = null;
		apiFetch.mockReset();
		closestCenter.mockReset();
		pointerWithin.mockReset();
		useDroppable.mockReturnValue( {
			isOver: false,
			setNodeRef: jest.fn(),
		} );
		useSortable.mockReturnValue( {
			attributes: {},
			isDragging: false,
			listeners: {},
			setNodeRef: jest.fn(),
			transform: null,
			transition: undefined,
		} );
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

	it( 'blurs the drag handle when layout dragging ends', () => {
		render(
			<RowProperties
				fields={ [
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						editable: true,
					},
					{
						id: 'field-8',
						label: 'Owner',
						cortextFieldType: 'text',
						editable: true,
					},
				] }
				onLayoutReorder={ jest.fn() }
				row={ {} }
			/>
		);

		const handle = screen.getAllByRole( 'button', {
			name: 'Reorder property',
		} )[ 0 ];
		handle.focus();
		expect( handle ).toHaveFocus();

		act( () => {
			mockDndProps.onDragEnd( {
				active: { id: 'field-7' },
				over: { id: 'field-8' },
			} );
		} );

		expect( handle ).not.toHaveFocus();
	} );

	it( 'keeps text-like properties single-line while saving a minimal row patch', async () => {
		jest.useFakeTimers();
		apiFetch.mockResolvedValue( {
			id: 99,
			title: { raw: 'Current title', rendered: 'Current title' },
			meta: { 'field-7': 'https://example.com bad' },
		} );

		try {
			render(
				<RowProperties
					fields={ [
						{
							id: 'field-7',
							label: 'Website',
							cortextFieldType: 'url',
							editable: true,
						},
					] }
					row={ { id: 99 } }
				/>
			);

			const input = screen.getByRole( 'textbox', { name: 'Website' } );
			const enter = createEvent.keyDown( input, {
				key: 'Enter',
				code: 'Enter',
			} );
			fireEvent( input, enter );

			expect( enter.defaultPrevented ).toBe( true );

			fireEvent.change( input, {
				target: { value: 'https://example.com\nbad' },
			} );

			expect( input ).toHaveValue( 'https://example.com bad' );
			expect( apiFetch ).not.toHaveBeenCalled();

			await act( async () => {
				jest.advanceTimersByTime( 500 );
				await Promise.resolve();
			} );

			await waitFor( () =>
				expect( apiFetch ).toHaveBeenCalledWith( {
					path: '/wp/v2/crtxt_documents/99',
					method: 'POST',
					data: {
						meta: { 'field-7': 'https://example.com bad' },
					},
				} )
			);
			expect( mockEditPost ).not.toHaveBeenCalled();
		} finally {
			jest.useRealTimers();
		}
	} );

	it( 'shows row meta updates from the table over stale editor meta', () => {
		const fields = [
			{
				id: 'field-7',
				label: 'Status',
				cortextFieldType: 'text',
				editable: true,
			},
		];

		const { rerender } = render(
			<RowProperties
				fields={ fields }
				row={ { id: 99, meta: { 'field-7': 'Open' } } }
			/>
		);

		expect( screen.getByRole( 'textbox', { name: 'Status' } ) ).toHaveValue(
			'Open'
		);

		rerender(
			<RowProperties
				fields={ fields }
				row={ { id: 99, meta: { 'field-7': 'Closed' } } }
			/>
		);

		expect( screen.getByRole( 'textbox', { name: 'Status' } ) ).toHaveValue(
			'Closed'
		);
	} );

	it( 'keeps a saved property visible until the row fallback catches up', async () => {
		jest.useFakeTimers();
		apiFetch.mockResolvedValue( {
			id: 99,
			meta: { 'field-7': 'Doing' },
		} );
		const fields = [
			{
				id: 'field-7',
				label: 'Status',
				cortextFieldType: 'text',
				editable: true,
			},
		];

		try {
			const { rerender } = render(
				<RowProperties
					fields={ fields }
					row={ { id: 99, meta: { 'field-7': 'Open' } } }
				/>
			);

			fireEvent.change(
				screen.getByRole( 'textbox', { name: 'Status' } ),
				{
					target: { value: 'Doing' },
				}
			);
			await act( async () => {
				jest.advanceTimersByTime( 500 );
				await Promise.resolve();
			} );

			rerender(
				<RowProperties
					fields={ fields }
					row={ { id: 99, meta: { 'field-7': 'Open' } } }
				/>
			);

			expect(
				screen.getByRole( 'textbox', { name: 'Status' } )
			).toHaveValue( 'Doing' );

			rerender(
				<RowProperties
					fields={ fields }
					row={ { id: 99, meta: { 'field-7': 'Doing' } } }
				/>
			);

			await waitFor( () =>
				expect(
					screen.getByRole( 'textbox', { name: 'Status' } )
				).toHaveValue( 'Doing' )
			);

			rerender(
				<RowProperties
					fields={ fields }
					row={ { id: 99, meta: { 'field-7': 'Closed' } } }
				/>
			);

			expect(
				screen.getByRole( 'textbox', { name: 'Status' } )
			).toHaveValue( 'Closed' );
		} finally {
			jest.useRealTimers();
		}
	} );

	it( 'keeps field save responses from overwriting other edited fields', async () => {
		jest.useFakeTimers();
		const resolvers = [];
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolvers.push( resolve );
				} )
		);

		try {
			render(
				<RowProperties
					fields={ [
						{
							id: 'field-7',
							label: 'Status',
							cortextFieldType: 'text',
							editable: true,
						},
						{
							id: 'field-8',
							label: 'Tags',
							cortextFieldType: 'text',
							editable: true,
						},
					] }
					row={ {
						id: 99,
						meta: { 'field-7': 'Open', 'field-8': '' },
					} }
				/>
			);

			fireEvent.change(
				screen.getByRole( 'textbox', { name: 'Status' } ),
				{
					target: { value: 'Doing' },
				}
			);
			await act( async () => {
				jest.advanceTimersByTime( 500 );
				await Promise.resolve();
			} );

			fireEvent.change( screen.getByRole( 'textbox', { name: 'Tags' } ), {
				target: { value: 'Tagged' },
			} );
			await act( async () => {
				jest.advanceTimersByTime( 500 );
				await Promise.resolve();
			} );

			expect( apiFetch ).toHaveBeenNthCalledWith( 1, {
				path: '/wp/v2/crtxt_documents/99',
				method: 'POST',
				data: { meta: { 'field-7': 'Doing' } },
			} );
			expect( apiFetch ).toHaveBeenNthCalledWith( 2, {
				path: '/wp/v2/crtxt_documents/99',
				method: 'POST',
				data: { meta: { 'field-8': 'Tagged' } },
			} );

			await act( async () => {
				resolvers[ 1 ]( {
					id: 99,
					meta: { 'field-7': 'Open', 'field-8': 'Tagged' },
				} );
				await Promise.resolve();
			} );
			expect(
				screen.getByRole( 'textbox', { name: 'Tags' } )
			).toHaveValue( 'Tagged' );

			await act( async () => {
				resolvers[ 0 ]( {
					id: 99,
					meta: { 'field-7': 'Doing', 'field-8': '' },
				} );
				await Promise.resolve();
			} );

			expect(
				screen.getByRole( 'textbox', { name: 'Status' } )
			).toHaveValue( 'Doing' );
			expect(
				screen.getByRole( 'textbox', { name: 'Tags' } )
			).toHaveValue( 'Tagged' );
		} finally {
			jest.useRealTimers();
		}
	} );

	it( 'remeasures text properties after the side peek width settles', () => {
		const originalResizeObserver = window.ResizeObserver;
		const originalRequestAnimationFrame = window.requestAnimationFrame;
		const originalCancelAnimationFrame = window.cancelAnimationFrame;
		let resizeCallback;
		let width = 0;
		let scrollHeight = 999;
		const rectSpy = jest
			.spyOn( window.HTMLElement.prototype, 'getBoundingClientRect' )
			.mockImplementation( () => ( {
				width,
				height: 0,
				top: 0,
				right: width,
				bottom: 0,
				left: 0,
				x: 0,
				y: 0,
				toJSON: () => {},
			} ) );
		const scrollHeightDescriptor = Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype,
			'scrollHeight'
		);
		Object.defineProperty(
			window.HTMLTextAreaElement.prototype,
			'scrollHeight',
			{
				configurable: true,
				get: () => scrollHeight,
			}
		);
		window.ResizeObserver = jest.fn( ( callback ) => {
			resizeCallback = callback;
			return {
				disconnect: jest.fn(),
				observe: jest.fn(),
			};
		} );
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			callback();
			return 1;
		} );
		window.cancelAnimationFrame = jest.fn();

		try {
			render(
				<RowProperties
					fields={ [
						{
							id: 'field-7',
							label: 'Notes',
							cortextFieldType: 'text',
							editable: true,
						},
					] }
					row={ {} }
				/>
			);

			const input = screen.getByRole( 'textbox', { name: 'Notes' } );
			expect( input.style.height ).toBe( '30px' );

			width = 320;
			scrollHeight = 42;
			act( () => resizeCallback() );

			expect( input.style.height ).toBe( '42px' );
		} finally {
			rectSpy.mockRestore();
			if ( scrollHeightDescriptor ) {
				Object.defineProperty(
					window.HTMLTextAreaElement.prototype,
					'scrollHeight',
					scrollHeightDescriptor
				);
			} else {
				delete window.HTMLTextAreaElement.prototype.scrollHeight;
			}
			window.ResizeObserver = originalResizeObserver;
			window.requestAnimationFrame = originalRequestAnimationFrame;
			window.cancelAnimationFrame = originalCancelAnimationFrame;
		}
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
				path: '/wp/v2/crtxt_documents/99',
				method: 'POST',
				data: {
					meta: { 'field-7': [ 456 ] },
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

		expect( screen.getByText( 'Hidden properties' ) ).toBeInTheDocument();
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
			.getByText( 'Hidden properties' )
			.closest( '.cortext-row-detail__property-hidden-separator' );
		const dropzone = screen.getByLabelText(
			'Drop properties here to hide them'
		);
		const wrapper = dropzone.closest(
			'.cortext-row-detail__property-hidden-dropzone-wrap'
		);

		expect( separator ).toBeInTheDocument();
		expect( wrapper ).toContainElement( separator );
		expect( wrapper ).toContainElement( dropzone );
		expect( dropzone ).toHaveClass(
			'cortext-row-detail__property-hidden-dropzone'
		);
		expect( screen.getByText( 'Status' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Owner' ) ).toBeInTheDocument();
	} );

	it( 'highlights the hidden fields drop zone while dragging over it', () => {
		useDroppable.mockReturnValue( {
			isOver: true,
			setNodeRef: jest.fn(),
		} );

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

		expect(
			screen.getByLabelText( 'Drop properties here to hide them' )
		).toHaveClass( 'is-over' );
	} );

	it( 'keeps the empty hidden fields drop zone out of sortable layout shifts', () => {
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

		expect( mockSortableContextProps.items ).toEqual( [
			'field-7',
			'field-8',
		] );
		expect(
			screen.getByLabelText( 'Drop properties here to hide them' )
		).toBeInTheDocument();
	} );

	it( 'does not render a static row preview inside the hidden fields drop zone', () => {
		const { container } = render(
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

		expect(
			container.querySelectorAll( '.cortext-row-detail__property' )
		).toHaveLength( 2 );
		expect(
			container.querySelector(
				'.cortext-row-detail__property-hidden-dropzone-preview'
			)
		).not.toBeInTheDocument();
		expect(
			container.querySelector(
				'.cortext-row-detail__property.is-dropping-into-hidden'
			)
		).not.toBeInTheDocument();
	} );

	it( 'uses a drag overlay for row property layout drags', () => {
		const { container } = render(
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
		container.querySelector(
			'[data-cortext-property-id="field-7"]'
		).getBoundingClientRect = jest.fn( () => ( { width: 384 } ) );

		act( () => {
			mockDndProps.onDragStart( {
				active: {
					id: 'field-7',
					rect: { current: { initial: { width: 512 } } },
				},
			} );
		} );

		expect( screen.getByTestId( 'drag-overlay' ) ).toHaveTextContent(
			'Status'
		);
		expect( screen.getByTestId( 'drag-overlay' ) ).toHaveTextContent(
			'Open'
		);
		expect(
			screen
				.getByTestId( 'drag-overlay' )
				.querySelector( '.cortext-row-detail__property-layout-chip' )
		).toBeInTheDocument();
		expect(
			screen
				.getByTestId( 'drag-overlay' )
				.querySelector( '.cortext-row-detail__property-drag-overlay' )
		).toHaveStyle( { width: '384px' } );
	} );

	it( 'ignores stale sortable dragging after the layout drag ends', () => {
		useSortable.mockReturnValue( {
			attributes: {},
			isDragging: true,
			listeners: {},
			setNodeRef: jest.fn(),
			transform: null,
			transition: undefined,
		} );

		const { container } = render(
			<RowProperties
				fields={ [
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						editable: true,
					},
					{
						id: 'field-8',
						label: 'Owner',
						cortextFieldType: 'text',
						editable: true,
					},
				] }
				onLayoutReorder={ jest.fn() }
				row={ {} }
			/>
		);

		expect(
			container.querySelector(
				'.cortext-row-detail__property.is-dragging'
			)
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'textbox', { name: 'Status' } )
		).toBeVisible();
	} );

	it( 'parks the source row space before the empty hidden fields drop zone', () => {
		useSortable.mockImplementation( ( { id } ) => ( {
			attributes: {},
			isDragging: id === 'field-7',
			listeners: {},
			setNodeRef: jest.fn(),
			transform: { x: 0, y: id === 'field-7' ? 40 : -40 },
			transition: 'transform 200ms ease',
		} ) );

		const { container } = render(
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
		container.querySelector(
			'[data-cortext-property-id="field-7"]'
		).getBoundingClientRect = jest.fn( () => ( {
			height: 48,
			width: 320,
		} ) );

		act( () => {
			mockDndProps.onDragStart( {
				active: { id: 'field-7' },
			} );
			mockDndProps.onDragOver( {
				active: { id: 'field-7' },
				over: { id: HIDDEN_PROPERTIES_DROP_TARGET },
			} );
		} );

		const collapsed = container.querySelector(
			'.cortext-row-detail__property.is-collapsed-for-hidden-drop'
		);
		expect( collapsed ).toHaveTextContent( 'Status' );
		expect( collapsed ).toHaveStyle( { transition: 'none' } );
		expect( collapsed.style.transform ).toBe( '' );
		const nextRow = container.querySelector(
			'[data-cortext-property-id="field-8"]'
		);
		expect( nextRow ).toHaveStyle( { transition: 'none' } );
		expect( nextRow.style.transform ).toBe( '' );
		const placeholder = container.querySelector(
			'.cortext-row-detail__property-hidden-placeholder'
		);
		const wrapper = screen
			.getByLabelText( 'Drop properties here to hide them' )
			.closest( '.cortext-row-detail__property-hidden-dropzone-wrap' );
		const separator = screen
			.getByText( 'Hidden properties' )
			.closest( '.cortext-row-detail__property-hidden-separator' );
		expect( placeholder ).toHaveStyle( { height: '48px' } );
		expect( wrapper ).toContainElement( placeholder );
		expect( placeholder.nextElementSibling ).toBe( separator );
	} );

	it( 'does not animate the row after dropping it into an empty hidden fields zone', () => {
		useSortable.mockImplementation( ( { id } ) => ( {
			attributes: {},
			isDragging: false,
			listeners: {},
			setNodeRef: jest.fn(),
			transform: id === 'field-7' ? { x: 0, y: -120 } : null,
			transition: id === 'field-7' ? 'transform 200ms ease' : undefined,
		} ) );

		const { container, rerender } = render(
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

		act( () => {
			mockDndProps.onDragStart( {
				active: { id: 'field-7' },
			} );
			mockDndProps.onDragOver( {
				active: { id: 'field-7' },
				over: { id: HIDDEN_PROPERTIES_DROP_TARGET },
			} );
			mockDndProps.onDragEnd( {
				active: { id: 'field-7' },
				over: { id: HIDDEN_PROPERTIES_DROP_TARGET },
			} );
		} );

		rerender(
			<RowProperties
				isLayoutEditing
				fields={ [
					{
						id: 'field-8',
						label: 'Owner',
						cortextFieldType: 'text',
						editable: true,
						cortextDetailVisible: true,
					},
					{
						id: 'field-7',
						label: 'Status',
						cortextFieldType: 'text',
						editable: true,
						cortextDetailVisible: false,
					},
				] }
				onLayoutReorder={ jest.fn() }
				row={ {} }
			/>
		);

		const hiddenRow = container.querySelector(
			'[data-cortext-property-id="field-7"]'
		);
		expect( hiddenRow ).toHaveStyle( { transition: 'none' } );
		expect( hiddenRow.style.transform ).toBe( '' );
		expect(
			useSortable.mock.calls
				.find(
					( [ options ] ) =>
						options.id === 'field-7' &&
						typeof options.animateLayoutChanges === 'function'
				)?.[ 0 ]
				.animateLayoutChanges()
		).toBe( false );
	} );

	it( 'prefers the hidden fields drop zone under the pointer', () => {
		const hiddenCollision = { id: HIDDEN_PROPERTIES_DROP_TARGET };
		const fallbackCollision = { id: 'field-8' };
		pointerWithin.mockReturnValue( [ hiddenCollision ] );
		closestCenter.mockReturnValue( [ fallbackCollision ] );

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

		expect(
			mockDndProps.collisionDetection( { droppableContainers: [] } )
		).toEqual( [ hiddenCollision ] );
		expect( closestCenter ).not.toHaveBeenCalled();
	} );
} );
