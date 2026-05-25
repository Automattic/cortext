import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockDeleteRun = jest.fn();
const mockDuplicateRun = jest.fn();

jest.mock( '@wordpress/components', () => {
	const {
		createElement,
		forwardRef,
		useState,
	} = require( '@wordpress/element' );

	const Button = forwardRef(
		(
			{
				children,
				icon,
				isPressed,
				label,
				onClick,
				size,
				variant,
				...rest
			},
			ref
		) =>
			createElement(
				'button',
				{
					...rest,
					ref,
					type: 'button',
					'aria-label': label,
					'aria-pressed': isPressed ? 'true' : 'false',
					onClick,
				},
				children ?? label
			)
	);
	Button.displayName = 'Button';

	const Dropdown = ( { renderToggle, renderContent } ) => {
		const [ isOpen, setIsOpen ] = useState( false );
		const onClose = () => setIsOpen( false );
		const onToggle = () => setIsOpen( ( current ) => ! current );

		return createElement(
			'div',
			null,
			renderToggle( { isOpen, onClose, onToggle } ),
			isOpen
				? createElement(
						'div',
						{ role: 'dialog' },
						renderContent( { onClose } )
				  )
				: null
		);
	};

	const Passthrough = ( { children } ) =>
		createElement( 'div', null, children );

	return {
		__esModule: true,
		Button,
		Dropdown,
		Icon: () => null,
		Popover: Passthrough,
		privateApis: {},
		__experimentalConfirmDialog: Passthrough,
	};
} );

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: jest.fn(),
} ) );

jest.mock( '../../../../src/lock-unlock', () => {
	const { createElement, forwardRef } = require( '@wordpress/element' );
	const Menu = ( { children } ) => createElement( 'div', null, children );
	Menu.Group = ( { children } ) => createElement( 'div', null, children );
	Menu.Item = forwardRef( ( { children, onClick }, ref ) =>
		createElement( 'button', { ref, onClick }, children )
	);
	Menu.Item.displayName = 'MenuItem';
	Menu.ItemLabel = ( { children } ) =>
		createElement( 'span', null, children );
	Menu.Popover = ( { children } ) => createElement( 'div', null, children );
	Menu.RadioItem = ( { checked, children, onChange } ) =>
		createElement(
			'button',
			{
				'aria-checked': checked ? 'true' : 'false',
				onClick: onChange,
				role: 'menuitemradio',
			},
			children
		);
	Menu.Separator = () => createElement( 'hr' );
	Menu.TriggerButton = ( { children } ) =>
		createElement( 'button', null, children );

	return {
		unlock: () => ( { Menu } ),
	};
} );

jest.mock( '../../../../src/hooks/useFieldMutations', () => ( {
	useDeleteField: () => ( { run: mockDeleteRun } ),
	useDuplicateField: () => ( { run: mockDuplicateRun } ),
} ) );

jest.mock( '../../../../src/components/CollectionFieldsContext', () => {
	const useCollectionFieldsContext = jest.fn();
	return {
		useCollectionFieldsContext,
		// Mirrors the real hook: look up a record id in the bulk-loaded fields
		// the provider exposes. Tests configure the field list via
		// `useCollectionFieldsContext.mockReturnValue` and this helper resolves
		// from the same data.
		useMappedField: ( recordId ) => {
			const { fields = [] } = useCollectionFieldsContext() ?? {};
			return fields.find( ( f ) => f.recordId === recordId ) ?? null;
		},
	};
} );

jest.mock( '../../../../src/components/fields/AddFieldPopover', () => ( {
	__esModule: true,
	default: ( { collectionId, onCreate } ) => (
		<div>
			<div>{ `Add field for collection ${ collectionId }` }</div>
			<button type="button" onClick={ () => onCreate?.( { id: 123 } ) }>
				Create mock field
			</button>
			<button
				type="button"
				onClick={ () => onCreate?.( { id: 124, type: 'rollup' } ) }
			>
				Create mock rollup
			</button>
		</div>
	),
} ) );

import ColumnHeaderActions from '../../../../src/components/fields/ColumnHeaderActions';
import { useEntityRecord } from '@wordpress/core-data';
import { useCollectionFieldsContext } from '../../../../src/components/CollectionFieldsContext';

function Harness( {
	collectionId,
	onChangeView = jest.fn(),
	recordId,
	view,
	onFieldCreated = jest.fn(),
	onRowsChanged = jest.fn(),
} ) {
	return (
		<div className="cortext-data-view">
			<table>
				<thead>
					<tr>
						{ recordId ? (
							<th>
								<span data-cortext-field-marker={ recordId } />
							</th>
						) : null }
						<th className="dataviews-view-table__actions-column" />
					</tr>
				</thead>
			</table>
			<ColumnHeaderActions
				collectionId={ collectionId }
				view={ view ?? { fields: [] } }
				onChangeView={ onChangeView }
				onFieldCreated={ onFieldCreated }
				onRowsChanged={ onRowsChanged }
			/>
		</div>
	);
}

describe( 'ColumnHeaderActions', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		mockDuplicateRun.mockResolvedValue( { id: 88, type: 'text' } );
		useCollectionFieldsContext.mockReturnValue( { fields: [] } );
		useEntityRecord.mockReturnValue( {
			record: {
				id: 77,
				title: { raw: 'Invoices', rendered: 'Invoices' },
				meta: { type: 'relation' },
			},
		} );
	} );

	it( 'closes the add-field dropdown when the collection changes', async () => {
		const { rerender } = render( <Harness collectionId={ 5 } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add field' } )
		);

		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent(
			'Add field for collection 5'
		);

		rerender( <Harness collectionId={ 6 } /> );

		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'clears checked sort items when the view sort is cleared', async () => {
		const { rerender } = render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				view={ {
					fields: [ 'field-77' ],
					sort: { field: 'field-77', direction: 'asc' },
				} }
			/>
		);

		expect(
			await screen.findByRole( 'menuitemradio', {
				name: 'Sort ascending',
			} )
		).toHaveAttribute( 'aria-checked', 'true' );

		rerender(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				view={ {
					fields: [ 'field-77' ],
					sort: null,
				} }
			/>
		);

		expect(
			await screen.findByRole( 'menuitemradio', {
				name: 'Sort ascending',
			} )
		).toHaveAttribute( 'aria-checked', 'false' );
		expect(
			screen.getByRole( 'menuitemradio', {
				name: 'Sort descending',
			} )
		).toHaveAttribute( 'aria-checked', 'false' );
	} );

	it( 'shows the field type icon in custom column headers', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Amount',
					cortextType: 'number',
				},
			],
		} );

		const { container } = render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				view={ { fields: [ 'field-77' ] } }
			/>
		);

		expect(
			await screen.findByRole( 'button', { name: 'Amount' } )
		).toBeInTheDocument();
		expect(
			container.querySelector(
				'.cortext-column-header-type-icon[data-cortext-field-type="number"]'
			)
		).toBeInTheDocument();
	} );

	it( 'passes the created field out of the add-field dropdown', async () => {
		const onFieldCreated = jest.fn();
		render(
			<Harness collectionId={ 5 } onFieldCreated={ onFieldCreated } />
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add field' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Create mock field',
			} )
		);

		expect( onFieldCreated ).toHaveBeenCalledWith( { id: 123 } );
		await waitFor( () =>
			expect( screen.queryByRole( 'dialog' ) ).not.toBeInTheDocument()
		);
	} );

	it( 'refreshes rows when a created field is a rollup', async () => {
		const onRowsChanged = jest.fn();
		render(
			<Harness collectionId={ 5 } onRowsChanged={ onRowsChanged } />
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Add field' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Create mock rollup',
			} )
		);

		expect( onRowsChanged ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'refreshes rows when duplicating a rollup field', async () => {
		mockDuplicateRun.mockResolvedValue( { id: 88, type: 'rollup' } );
		const onRowsChanged = jest.fn();
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Invoice total',
					cortextType: 'rollup',
				},
			],
		} );

		render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				onRowsChanged={ onRowsChanged }
			/>
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Duplicate' } )
		);

		await waitFor( () => expect( onRowsChanged ).toHaveBeenCalled() );
		expect( mockDuplicateRun ).toHaveBeenCalledWith( 77 );
	} );

	it( 'warns when deleting a field will also delete dependent rollups', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Invoices',
					cortextType: 'relation',
				},
				{
					id: 'field-88',
					recordId: 88,
					label: 'Invoice total',
					cortextType: 'rollup',
					rollupRelationFieldId: 77,
					rollupTargetFieldId: 99,
				},
			],
		} );

		render( <Harness collectionId={ 5 } recordId={ 77 } /> );

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Delete' } )
		);

		expect(
			screen.getByText(
				'This will also delete 1 rollup that depends on it:',
				{ exact: false }
			)
		).toBeInTheDocument();
		expect( screen.getByText( /Invoice total/ ) ).toBeInTheDocument();
	} );
} );
