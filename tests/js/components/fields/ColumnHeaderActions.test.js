import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const mockDeleteFieldRun = jest.fn();
const mockDuplicateFieldRun = jest.fn();
const mockFlushFieldRecord = jest.fn();
const mockUpdateFieldOptionsRun = jest.fn();
const mockUpdateFormulaRun = jest.fn();
const mockChangeFieldTypeRun = jest.fn();
const mockSaveEntityRecord = jest.fn();

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
				isBusy,
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
	const TextControl = ( { label, value = '', onBlur, onChange } ) =>
		createElement(
			'label',
			null,
			label,
			createElement( 'input', {
				'aria-label': label,
				value,
				onChange: ( event ) => onChange?.( event.target.value ),
				onBlur,
			} )
		);
	const TextareaControl = ( { label, value = '', onBlur, onChange } ) =>
		createElement(
			'label',
			null,
			label,
			createElement( 'textarea', {
				'aria-label': label,
				value,
				onChange: ( event ) => onChange?.( event.target.value ),
				onBlur,
			} )
		);
	const SelectControl = ( { label, value = '', options = [], onChange } ) =>
		createElement(
			'label',
			null,
			label,
			createElement(
				'select',
				{
					'aria-label': label,
					value,
					onChange: ( event ) => onChange?.( event.target.value ),
				},
				options.map( ( option ) =>
					createElement(
						'option',
						{ key: option.value, value: option.value },
						option.label
					)
				)
			)
		);
	const CheckboxControl = ( { label, checked = false, onChange } ) =>
		createElement(
			'label',
			null,
			createElement( 'input', {
				type: 'checkbox',
				checked,
				onChange: ( event ) => onChange?.( event.target.checked ),
			} ),
			label
		);

	return {
		__esModule: true,
		Button,
		CheckboxControl,
		Dropdown,
		Icon: () => null,
		Notice: Passthrough,
		Popover: Passthrough,
		SelectControl,
		TextControl,
		TextareaControl,
		VisuallyHidden: ( { children } ) =>
			createElement( 'span', null, children ),
		privateApis: {},
		__experimentalConfirmDialog: Passthrough,
		__experimentalNumberControl: TextControl,
	};
} );

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: () => ( { saveEntityRecord: mockSaveEntityRecord } ),
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
	useChangeFieldType: () => ( {
		run: mockChangeFieldTypeRun,
		isBusy: false,
		error: null,
	} ),
	useDeleteField: () => ( { run: mockDeleteFieldRun } ),
	useDuplicateField: () => ( { run: mockDuplicateFieldRun } ),
	useFlushFieldRecord: () => mockFlushFieldRecord,
	useOptionUsage: () => ( { run: jest.fn().mockResolvedValue( 0 ) } ),
	useUpdateFieldOptions: () => ( {
		run: mockUpdateFieldOptionsRun,
		isBusy: false,
		error: null,
	} ),
	useUpdateFormulaExpression: () => ( {
		run: mockUpdateFormulaRun,
		isBusy: false,
		error: null,
	} ),
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

jest.mock( '../../../../src/components/fields/FieldFormatPopover', () => ( {
	__esModule: true,
	default: ( { onSaved } ) => (
		<button type="button" onClick={ () => onSaved?.( { style: 'comma' } ) }>
			Save mock format
		</button>
	),
} ) );

jest.mock( '../../../../src/components/TableCalculationMenu', () => ( {
	TableCalculationPopover: () => <div data-testid="calculation-popover" />,
} ) );

jest.mock( '../../../../src/components/EditableCell', () => {
	const { createContext } = require( '@wordpress/element' );

	return {
		__esModule: true,
		RowMutationContext: createContext( { formatOverrides: {} } ),
	};
} );

import ColumnHeaderActions from '../../../../src/components/fields/ColumnHeaderActions';
import { useEntityRecord } from '@wordpress/core-data';
import { useCollectionFieldsContext } from '../../../../src/components/CollectionFieldsContext';

function Harness( {
	collectionId,
	onChangeView = jest.fn(),
	recordId,
	view,
	onFieldCreated = jest.fn(),
	onFieldFormatSaved = jest.fn(),
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
				onFieldFormatSaved={ onFieldFormatSaved }
				onRowsChanged={ onRowsChanged }
			/>
		</div>
	);
}

describe( 'ColumnHeaderActions', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		mockDuplicateFieldRun.mockResolvedValue( { id: 88, type: 'text' } );
		mockSaveEntityRecord.mockResolvedValue( { id: 77 } );
		mockUpdateFieldOptionsRun.mockResolvedValue( { options: [] } );
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
		expect(
			screen.getByRole( 'button', { name: 'Format' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Edit field' } )
		).not.toBeInTheDocument();
	} );

	it( 'shows field descriptions in custom column headers', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Amount',
					description: 'Expected invoice total.',
					cortextType: 'number',
				},
			],
		} );

		render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				view={ { fields: [ 'field-77' ] } }
			/>
		);

		expect(
			await screen.findByRole( 'button', {
				name: 'About Amount',
			} )
		).toBeInTheDocument();
	} );

	it( 'saves field descriptions and defaults from field settings', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Status',
					description: '',
					cortextType: 'text',
					cortextDefaultConfig: null,
				},
			],
		} );

		render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				view={ { fields: [ 'field-77' ] } }
			/>
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Field settings' } )
		);
		fireEvent.change( screen.getByLabelText( 'Description' ), {
			target: { value: 'How editors should fill this field.' },
		} );
		fireEvent.blur( screen.getByLabelText( 'Description' ) );

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_field',
				{
					id: 77,
					meta: {
						description: 'How editors should fill this field.',
					},
				}
			)
		);

		expect(
			screen.queryByRole( 'button', { name: 'Clear default' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Cancel' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'No default' } )
		).toHaveAttribute( 'aria-pressed', 'true' );

		const defaultInput = screen.getByLabelText( 'Default value' );
		fireEvent.change( defaultInput, {
			target: { value: 'Draft' },
		} );
		expect(
			screen.getByRole( 'button', { name: 'No default' } )
		).toHaveAttribute( 'aria-pressed', 'false' );
		fireEvent.blur( defaultInput );

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_field',
				{
					id: 77,
					meta: {
						default_value: '{"mode":"value","value":"Draft"}',
					},
				}
			)
		);
	} );

	it( 'uses the option picker for select defaults', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Status',
					description: '',
					cortextType: 'select',
					cortextElements: [
						{
							value: 'todo',
							label: 'To do',
							color: 'blue',
						},
					],
					cortextDefaultConfig: null,
				},
			],
		} );

		render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				view={ { fields: [ 'field-77' ] } }
			/>
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Field settings' } )
		);

		expect(
			screen.queryByRole( 'combobox', { name: 'Default' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByRole( 'textbox', { name: 'Search or create option' } )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'To do' } ) );

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_field',
				{
					id: 77,
					meta: {
						default_value: '{"mode":"value","value":"todo"}',
					},
				}
			)
		);
	} );

	it( 'hides default controls for unsupported field types', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Assignee',
					description: '',
					cortextType: 'relation',
					cortextDefaultConfig: null,
				},
			],
		} );

		render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				view={ { fields: [ 'field-77' ] } }
			/>
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Field settings' } )
		);

		expect( screen.getByLabelText( 'Description' ) ).toBeInTheDocument();
		expect( screen.queryByLabelText( 'Default' ) ).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Clear default' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Cancel' } )
		).not.toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save' } )
		).not.toBeInTheDocument();
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
		mockDuplicateFieldRun.mockResolvedValue( { id: 88, type: 'rollup' } );
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
		expect( mockDuplicateFieldRun ).toHaveBeenCalledWith( 77 );
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

	it( 'shows select field options in the shared field menu', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Tags',
					cortextType: 'multiselect',
					cortextElements: [],
				},
			],
		} );

		render( <Harness collectionId={ 5 } recordId={ 77 } /> );

		expect(
			await screen.findByRole( 'button', { name: 'Manage choices' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Change type…' } )
		).toBeInTheDocument();
	} );

	it( 'shows format controls for number fields', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Year',
					cortextType: 'number',
				},
			],
		} );

		render( <Harness collectionId={ 5 } recordId={ 77 } /> );

		expect(
			await screen.findByRole( 'button', { name: 'Format' } )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Change type…' } )
		).toBeInTheDocument();
	} );

	it( 'keeps table header submenus mutually exclusive', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Score',
					cortextType: 'number',
				},
			],
		} );

		render( <Harness collectionId={ 5 } recordId={ 77 } /> );

		const format = await screen.findByRole( 'button', {
			name: 'Format',
		} );
		const calculate = screen.getByRole( 'button', {
			name: 'Calculate',
		} );

		fireEvent.click( format );
		expect(
			screen.getByRole( 'button', { name: 'Save mock format' } )
		).toBeInTheDocument();

		fireEvent.click( calculate );
		expect(
			screen.getByTestId( 'calculation-popover' )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Save mock format' } )
		).not.toBeInTheDocument();

		fireEvent.click( format );
		expect(
			screen.getByRole( 'button', { name: 'Save mock format' } )
		).toBeInTheDocument();
		expect(
			screen.queryByTestId( 'calculation-popover' )
		).not.toBeInTheDocument();
	} );

	it( 'shows change type for plain text fields', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Author',
					cortextType: 'text',
				},
			],
		} );

		render( <Harness collectionId={ 5 } recordId={ 77 } /> );

		expect(
			await screen.findByRole( 'button', { name: 'Change type…' } )
		).toBeInTheDocument();
	} );

	it( 'hides change type for relation fields', async () => {
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Invoices',
					cortextType: 'relation',
				},
			],
		} );

		render( <Harness collectionId={ 5 } recordId={ 77 } /> );

		await screen.findByRole( 'button', { name: 'Rename' } );
		expect(
			screen.queryByRole( 'button', { name: 'Change type…' } )
		).not.toBeInTheDocument();
	} );

	it( 'duplicates fields and refreshes rows from the shared field menu', async () => {
		const onRowsChanged = jest.fn();
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Author',
					cortextType: 'text',
				},
			],
		} );
		mockDuplicateFieldRun.mockResolvedValue( { id: 88 } );

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

		await waitFor( () =>
			expect( mockDuplicateFieldRun ).toHaveBeenCalledWith( 77 )
		);
		expect( onRowsChanged ).toHaveBeenCalled();
	} );

	it( 'stores format changes and refreshes rows from the shared field menu', async () => {
		const onFieldFormatSaved = jest.fn();
		const onRowsChanged = jest.fn();
		useCollectionFieldsContext.mockReturnValue( {
			fields: [
				{
					id: 'field-77',
					recordId: 77,
					label: 'Score',
					cortextType: 'number',
				},
			],
		} );

		render(
			<Harness
				collectionId={ 5 }
				recordId={ 77 }
				onFieldFormatSaved={ onFieldFormatSaved }
				onRowsChanged={ onRowsChanged }
			/>
		);

		fireEvent.click(
			await screen.findByRole( 'button', { name: 'Format' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save mock format' } )
		);

		expect( onFieldFormatSaved ).toHaveBeenCalledWith( 77, {
			style: 'comma',
		} );
		expect( onRowsChanged ).toHaveBeenCalled();
	} );
} );
