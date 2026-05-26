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
					</>
				) : null }
			</div>
		);
	},
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
		onToggleVisible: jest.fn(),
	};
} );

describe( 'document-properties Edit layout mode', () => {
	it( 'keeps layout edits in draft until Save persists collection meta', async () => {
		render( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).toHaveTextContent(
			'Author'
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit layout' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', {
				name: 'Drag Created before Author',
			} )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Hide Created' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save layout' } )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_collection',
				{
					id: 77,
					meta: {
						detail_layout: {
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

	it( 'shows hidden fields at the end while editing layout', () => {
		render( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).not.toHaveTextContent(
			'Hidden field'
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit layout' } )
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
			screen.getByRole( 'button', { name: 'Edit layout' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Drag Author to hidden' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save layout' } )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_collection',
				{
					id: 77,
					meta: {
						detail_layout: {
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

	it( 'cancels draft edits without saving', () => {
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit layout' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Hide Created' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Cancel layout changes' } )
		);

		expect( mockSaveEntityRecord ).not.toHaveBeenCalled();
		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
	} );

	it( 'saves direct row drag reorder without entering Save/Cancel mode', async () => {
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
				'crtxt_collection',
				{
					id: 77,
					meta: {
						detail_layout: {
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

	it( 'shows a save error without leaving layout mode', async () => {
		mockSaveEntityRecord.mockRejectedValueOnce(
			new Error( 'No permission to save.' )
		);
		render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit layout' } )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Save layout' } )
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
