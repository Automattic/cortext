import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/components', () => {
	const { createElement, forwardRef } = require( '@wordpress/element' );

	const Button = forwardRef( ( props, ref ) => {
		const { children, label, onClick, ...rest } = props;
		delete rest.icon;
		delete rest.size;
		return createElement(
			'button',
			{
				ref,
				type: 'button',
				onClick,
				'aria-label': label,
				...rest,
			},
			children ?? label
		);
	} );
	Button.displayName = 'Button';

	const Icon = () => createElement( 'span', null );
	const MenuGroup = ( { children } ) =>
		createElement( 'div', null, children );
	const MenuItem = ( props ) => {
		const { children, onClick, ...rest } = props;
		delete rest.icon;
		delete rest.isDestructive;
		return createElement(
			'button',
			{ type: 'button', onClick, ...rest },
			children
		);
	};
	const Notice = ( { children } ) =>
		createElement( 'div', { role: 'alert' }, children );
	const Popover = ( { children } ) => createElement( 'div', null, children );
	const TextControl = ( { label, value, onChange, onBlur, onKeyDown } ) =>
		createElement( 'label', null, [
			label,
			createElement( 'input', {
				key: 'input',
				value,
				onChange: ( event ) => onChange( event.target.value ),
				onBlur,
				onKeyDown,
			} ),
		] );

	return {
		__esModule: true,
		Button,
		Icon,
		MenuGroup,
		MenuItem,
		Notice,
		Popover,
		TextControl,
	};
} );

jest.mock( '@wordpress/icons', () => ( {
	__esModule: true,
	check: 'check-icon',
	dragHandle: 'drag-handle-icon',
	moreHorizontal: 'more-horizontal-icon',
	trash: 'trash-icon',
} ) );

jest.mock( '@dnd-kit/core', () => ( {
	__esModule: true,
	DndContext: ( { children } ) => children,
	PointerSensor: jest.fn(),
	closestCenter: jest.fn(),
	useSensor: jest.fn( () => ( {} ) ),
	useSensors: jest.fn( ( ...sensors ) => sensors ),
} ) );

jest.mock( '@dnd-kit/sortable', () => ( {
	__esModule: true,
	SortableContext: ( { children } ) => children,
	arrayMove: jest.fn( ( items, from, to ) => {
		const next = [ ...items ];
		const [ item ] = next.splice( from, 1 );
		next.splice( to, 0, item );
		return next;
	} ),
	useSortable: jest.fn( () => ( {
		attributes: {},
		listeners: {},
		setNodeRef: jest.fn(),
		transform: null,
		transition: undefined,
	} ) ),
	verticalListSortingStrategy: {},
} ) );

const mockUpdateRun = jest.fn();
const mockFlushRun = jest.fn();

jest.mock( '../../../src/hooks/useFieldMutations', () => ( {
	__esModule: true,
	useUpdateFieldOptions: () => ( {
		run: mockUpdateRun,
		error: null,
	} ),
	useFlushFieldRecord: () => mockFlushRun,
} ) );

import EditOptionsPopover from '../../../src/components/fields/EditOptionsPopover';

describe( 'EditOptionsPopover', () => {
	beforeEach( () => {
		mockUpdateRun.mockReset();
		mockUpdateRun.mockResolvedValue( { id: 7 } );
		mockFlushRun.mockReset();
	} );

	it( 'stores explicit default color instead of clearing it', async () => {
		render(
			<EditOptionsPopover
				recordId={ 7 }
				fieldType="select"
				initialOptions={ [
					{ value: 'todo', label: 'To do', color: 'blue' },
				] }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit option' } )
		);
		fireEvent.click(
			screen.getByRole( 'menuitemradio', { name: /Default/ } )
		);

		await waitFor( () =>
			expect( mockUpdateRun ).toHaveBeenCalledWith(
				7,
				[ { value: 'todo', label: 'To do', color: 'default' } ],
				undefined
			)
		);
	} );

	it( 'keeps pick-mode cell editors open after a color edit saves', async () => {
		const onOptionsSaved = jest.fn();
		render(
			<EditOptionsPopover
				recordId={ 7 }
				fieldType="select"
				initialOptions={ [
					{ value: 'high', label: 'High', color: 'orange' },
				] }
				value="high"
				onPick={ jest.fn() }
				onOptionsSaved={ onOptionsSaved }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit option' } )
		);
		fireEvent.click( screen.getByRole( 'menuitemradio', { name: /Red/ } ) );

		await waitFor( () =>
			expect( mockUpdateRun ).toHaveBeenCalledWith(
				7,
				[ { value: 'high', label: 'High', color: 'red' } ],
				undefined
			)
		);
		expect(
			screen.getByLabelText( 'Search or create option' )
		).toBeInTheDocument();
		expect( onOptionsSaved ).toHaveBeenCalledWith( [
			{ value: 'high', label: 'High', color: 'red' },
		] );
	} );

	it( 'does not close pick-mode editors when a color edit fails', async () => {
		mockUpdateRun.mockRejectedValueOnce( new Error( 'nope' ) );
		render(
			<EditOptionsPopover
				recordId={ 7 }
				fieldType="select"
				initialOptions={ [
					{ value: 'high', label: 'High', color: 'orange' },
				] }
				value="high"
				onPick={ jest.fn() }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit option' } )
		);
		fireEvent.click( screen.getByRole( 'menuitemradio', { name: /Red/ } ) );

		await waitFor( () => expect( mockUpdateRun ).toHaveBeenCalled() );
		expect(
			screen.getByLabelText( 'Search or create option' )
		).toBeInTheDocument();
	} );

	it( 'focuses the search input when the token input surface is clicked', () => {
		render(
			<EditOptionsPopover
				recordId={ 7 }
				fieldType="multiselect"
				initialOptions={ [ { value: 'todo', label: 'To do' } ] }
				value={ [ 'todo' ] }
				onPick={ jest.fn() }
			/>
		);

		const input = screen.getByLabelText( 'Search or create option' );
		fireEvent.pointerDown(
			input.closest( '.cortext-edit-options-popover__token-input' )
		);

		expect( input ).toHaveFocus();
	} );
} );
