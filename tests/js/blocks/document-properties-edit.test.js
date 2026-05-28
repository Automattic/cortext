import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockContext;
let mockCanEdit;
let mockIsSaving;
let mockSaveEntityRecord;
let mockRowPropertiesProps;

jest.mock( '@wordpress/block-editor', () => ( {
	__esModule: true,
	BlockControls: ( { children } ) => <div role="toolbar">{ children }</div>,
	InspectorControls: ( { children } ) => <div>{ children }</div>,
	useBlockProps: ( props ) => props,
} ) );

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Button: ( { children, className, disabled, label, onClick } ) => (
		<button
			type="button"
			className={ className }
			disabled={ disabled }
			onClick={ onClick }
		>
			{ children ?? label }
		</button>
	),
	Notice: ( { children } ) => <div role="alert">{ children }</div>,
	ToolbarButton: ( { disabled, label, onClick } ) => (
		<button type="button" disabled={ disabled } onClick={ onClick }>
			{ label }
		</button>
	),
	ToolbarGroup: ( { children } ) => <div>{ children }</div>,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	store: {},
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: () => ( { saveEntityRecord: mockSaveEntityRecord } ),
	useSelect: ( callback ) =>
		callback( () => ( {
			canUser: () => mockCanEdit,
			isSavingEntityRecord: () => mockIsSaving,
		} ) ),
} ) );

jest.mock( '../../../src/components/DocumentPropertiesActions', () => ( {
	__esModule: true,
	default: () => null,
} ) );

jest.mock( '../../../src/components/RowProperties', () => ( {
	__esModule: true,
	default: ( props ) => {
		mockRowPropertiesProps = props;
		const {
			fields,
			isLayoutEditing,
			onLayoutReorder,
			onLayoutVisibilityToggle,
		} = props;
		return (
			<div data-testid="row-properties">
				{ fields
					.filter( ( field ) => field.id !== 'title' )
					.map( ( field ) => (
						<span key={ field.id }>{ field.label }</span>
					) ) }
				{ onLayoutReorder ? (
					<button
						type="button"
						onClick={ () =>
							onLayoutReorder( 'created_at', 'field-10' )
						}
					>
						Drag Created before Author
					</button>
				) : null }
				{ isLayoutEditing && onLayoutVisibilityToggle ? (
					<>
						<button
							type="button"
							onClick={ () =>
								onLayoutVisibilityToggle( 'created_at' )
							}
						>
							Hide Created
						</button>
						<button
							type="button"
							onClick={ () =>
								onLayoutReorder( 'field-10', 'field-11' )
							}
						>
							Drag Author to hidden
						</button>
						<button
							type="button"
							onClick={ () =>
								onLayoutReorder(
									'field-10',
									'cortext-row-properties-hidden-drop-target'
								)
							}
						>
							Drag Author to hidden start
						</button>
						<button
							type="button"
							onClick={ () =>
								onLayoutReorder( 'field-11', 'field-10' )
							}
						>
							Drag Hidden to visible
						</button>
						<button
							type="button"
							onClick={ () =>
								onLayoutReorder(
									'field-11',
									'cortext-row-properties-hidden-drop-target'
								)
							}
						>
							Drag Hidden to visible end
						</button>
					</>
				) : null }
			</div>
		);
	},
	HIDDEN_PROPERTIES_DROP_TARGET: 'cortext-row-properties-hidden-drop-target',
} ) );

jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	__esModule: true,
	useDocumentPropertiesContext: () => mockContext,
} ) );

import Edit from '../../../src/blocks/document-properties/edit';

const fields = [
	{ id: 'title', label: 'Title' },
	{ id: 'field-10', label: 'Author' },
	{ id: 'created_at', label: 'Created' },
];
const allFields = [ ...fields, { id: 'field-11', label: 'Hidden field' } ];

beforeEach( () => {
	mockCanEdit = true;
	mockIsSaving = false;
	mockSaveEntityRecord = jest.fn().mockResolvedValue( {} );
	mockRowPropertiesProps = null;
	mockContext = {
		collectionId: 77,
		rowId: 123,
		fields,
		allFields,
		detailLayoutEntries: [
			{ field: 'field-10', visible: true },
			{ field: 'created_at', visible: true },
			{ field: 'field-11', visible: false },
		],
		fallbackRecord: { id: 123 },
		isResolving: false,
		isVisible: true,
		layoutEditRequest: 0,
		onLayoutEditingChange: jest.fn(),
		onToggleVisible: jest.fn(),
	};
} );

describe( 'document-properties Customize properties mode', () => {
	it( 'saves layout edits when fields move or change visibility', async () => {
		render( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'Author'
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Created before Author',
			} )
		);
		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledTimes( 1 )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Hide Created' } )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenLastCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'created_at', visible: false },
								{ field: 'field-10', visible: true },
								{ field: 'field-11', visible: false },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'passes row save context to row properties', () => {
		render( <Edit /> );

		expect( mockRowPropertiesProps ).toEqual(
			expect.objectContaining( {
				collectionId: 77,
				rowId: 123,
			} )
		);
	} );

	it( 'enters layout editing from a toolbar request', async () => {
		const { rerender } = render( <Edit /> );

		mockContext = { ...mockContext, layoutEditRequest: 1 };
		rerender( <Edit /> );

		expect(
			await screen.findByRole( 'button', {
				name: 'Done customizing',
			} )
		).toBeInTheDocument();
		expect( mockRowPropertiesProps ).toEqual(
			expect.objectContaining( { isLayoutEditing: true } )
		);
	} );

	it( 'reports layout editing changes to the toolbar', async () => {
		const onLayoutEditingChange = jest.fn();
		mockContext = { ...mockContext, onLayoutEditingChange };
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);

		await waitFor( () =>
			expect( onLayoutEditingChange ).toHaveBeenCalledWith( true )
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Done customizing' } )
		);

		await waitFor( () =>
			expect( onLayoutEditingChange ).toHaveBeenCalledWith( false )
		);
	} );

	it( 'toggles layout editing off from a second toolbar request', async () => {
		const { rerender } = render( <Edit /> );

		mockContext = { ...mockContext, layoutEditRequest: 1 };
		rerender( <Edit /> );

		await screen.findByRole( 'button', {
			name: 'Done customizing',
		} );

		mockContext = { ...mockContext, layoutEditRequest: 2 };
		rerender( <Edit /> );

		expect(
			await screen.findByRole( 'button', {
				name: 'Customize properties',
			} )
		).toBeInTheDocument();
		expect( mockRowPropertiesProps ).toEqual(
			expect.objectContaining( { isLayoutEditing: false } )
		);
	} );

	it( 'shows properties before editing from a toolbar request', async () => {
		const onToggleVisible = jest.fn();
		mockContext = {
			...mockContext,
			isVisible: false,
			layoutEditRequest: 1,
			onToggleVisible,
		};

		const { rerender } = render( <Edit /> );

		await waitFor( () => expect( onToggleVisible ).toHaveBeenCalled() );
		mockContext = { ...mockContext, isVisible: true };
		rerender( <Edit /> );

		expect(
			await screen.findByRole( 'button', {
				name: 'Done customizing',
			} )
		).toBeInTheDocument();
	} );

	it( 'shows hidden fields at the end while editing layout', () => {
		render( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).not.toHaveTextContent(
			'Hidden field'
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);

		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'Hidden field'
		);
		expect(
			mockRowPropertiesProps.fields.map( ( field ) => field.id )
		).toEqual( [ 'field-10', 'created_at', 'field-11' ] );
	} );

	it( 'hides fields dragged into the hidden group', async () => {
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Drag Author to hidden' } )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'created_at', visible: true },
								{ field: 'field-11', visible: false },
								{ field: 'field-10', visible: false },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'uses the displayed hidden-last order when saving layout drags', async () => {
		mockContext = {
			...mockContext,
			detailLayoutEntries: [
				{ field: 'field-10', visible: true },
				{ field: 'field-11', visible: false },
				{ field: 'created_at', visible: true },
			],
		};
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		expect(
			mockRowPropertiesProps.fields.map( ( field ) => field.id )
		).toEqual( [ 'field-10', 'created_at', 'field-11' ] );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Drag Author to hidden' } )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'created_at', visible: true },
								{ field: 'field-11', visible: false },
								{ field: 'field-10', visible: false },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'hides fields dropped on the hidden group separator', async () => {
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Author to hidden start',
			} )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'created_at', visible: true },
								{ field: 'field-10', visible: false },
								{ field: 'field-11', visible: false },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'hides fields dropped into an empty hidden group', async () => {
		mockContext = {
			...mockContext,
			detailLayoutEntries: [
				{ field: 'field-10', visible: true },
				{ field: 'created_at', visible: true },
				{ field: 'field-11', visible: true },
			],
		};
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Author to hidden start',
			} )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'created_at', visible: true },
								{ field: 'field-11', visible: true },
								{ field: 'field-10', visible: false },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'shows fields dragged out of the hidden group', async () => {
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Drag Hidden to visible' } )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'field-11', visible: true },
								{ field: 'field-10', visible: true },
								{ field: 'created_at', visible: true },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'shows hidden fields dropped at the end of the visible group', async () => {
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Hidden to visible end',
			} )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'field-10', visible: true },
								{ field: 'created_at', visible: true },
								{ field: 'field-11', visible: true },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'stops layout editing without rolling back saved changes', async () => {
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Hide Created' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Done customizing' } )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalled()
		);
		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
		expect( mockRowPropertiesProps ).toEqual(
			expect.objectContaining( { isLayoutEditing: false } )
		);
	} );

	it( 'saves direct row drag reorder without entering layout editing', async () => {
		render( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'AuthorCreated'
		);

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Created before Author',
			} )
		);

		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'CreatedAuthor'
		);
		expect(
			screen.queryByRole( 'button', { name: 'Save layout' } )
		).not.toBeInTheDocument();

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 77,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'created_at', visible: true },
								{ field: 'field-10', visible: true },
								{ field: 'field-11', visible: false },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'keeps the direct drag handle mounted while layout is saving', () => {
		mockIsSaving = true;
		render( <Edit /> );

		expect(
			screen.getByRole( 'button', {
				name: 'Drag Created before Author',
			} )
		).toBeInTheDocument();

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Created before Author',
			} )
		);

		expect( mockSaveEntityRecord ).not.toHaveBeenCalled();
	} );

	it( 'rolls back direct row drag reorder when saving fails', async () => {
		mockSaveEntityRecord.mockRejectedValueOnce(
			new Error( 'Could not update layout.' )
		);
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Created before Author',
			} )
		);

		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'CreatedAuthor'
		);
		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			'Could not update layout.'
		);
		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'AuthorCreated'
		);
	} );

	it( 'keeps new fields visible after an optimistic layout save', async () => {
		const { rerender } = render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Created before Author',
			} )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalled()
		);

		const reviewerField = { id: 'field-12', label: 'Reviewer' };
		mockContext = {
			...mockContext,
			fields: [ ...fields, reviewerField ],
			allFields: [ ...allFields, reviewerField ],
			detailLayoutEntries: [
				{ field: 'field-10', visible: true },
				{ field: 'created_at', visible: true },
				{ field: 'field-11', visible: false },
				{ field: 'field-12', visible: true },
			],
		};
		rerender( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'Reviewer'
		);
	} );

	it( 'shows a save error without leaving layout mode', async () => {
		mockSaveEntityRecord.mockRejectedValueOnce(
			new Error( 'No permission to save.' )
		);
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Hide Created' } )
		);

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			'No permission to save.'
		);
		expect( screen.getByTestId( 'row-properties' ) ).toBeVisible();
		expect( mockRowPropertiesProps ).toEqual(
			expect.objectContaining( { isLayoutEditing: true } )
		);
	} );
} );
