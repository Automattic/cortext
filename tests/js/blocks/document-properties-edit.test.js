import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';

let mockContext;
let mockCanEdit;
let mockCanEditById;
let mockIsSaving;
let mockPostStatus;
let mockSaveEntityRecord;
let mockRowPropertiesProps;
let mockTraitControlProps;
let mockUseActualTraitControl;
let mockFieldSave;
let mockTraits;
let mockTraitsDocumentId;
let mockAdditionalCounts;
let mockAdditionalProps;
let mockPreviousClientId;
let mockSelectBlock;

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '@wordpress/block-editor', () => ( {
	__esModule: true,
	BlockControls: ( { children } ) => <div role="toolbar">{ children }</div>,
	InspectorControls: ( { children } ) => <div>{ children }</div>,
	useBlockProps: ( props ) => props,
} ) );

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Button: require( '@wordpress/element' ).forwardRef(
		( { children, className, disabled, label, onClick }, ref ) => (
			<button
				ref={ ref }
				type="button"
				className={ className }
				disabled={ disabled }
				aria-label={ label }
				onClick={ onClick }
			>
				{ children ?? label }
			</button>
		)
	),
	Notice: ( { actions, children } ) => (
		<div role="alert">
			{ children }
			{ ( actions ?? [] ).map( ( action ) => (
				<button
					key={ action.label }
					type="button"
					onClick={ action.onClick }
				>
					{ action.label }
				</button>
			) ) }
		</div>
	),
	Popover: ( { children } ) => <div>{ children }</div>,
	SearchControl: ( { onChange, placeholder, value } ) => (
		<input
			aria-label={ placeholder }
			value={ value }
			onChange={ ( event ) => onChange( event.target.value ) }
		/>
	),
	Spinner: () => <span>loading</span>,
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
	useEntityRecords: () => ( {
		records: [],
		isResolving: false,
		totalPages: 1,
	} ),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: () => ( {
		invalidateResolution: jest.fn(),
		saveEntityRecord: mockSaveEntityRecord,
		selectBlock: mockSelectBlock,
	} ),
	useSelect: ( callback ) =>
		callback( () => ( {
			canUser: ( action, resource ) =>
				mockCanEditById?.[ resource?.id ] ?? mockCanEdit,
			isSavingEntityRecord: () => mockIsSaving,
			getCurrentPostAttribute: ( key ) =>
				key === 'status' ? mockPostStatus : undefined,
			getPreviousBlockClientId: () => mockPreviousClientId,
		} ) ),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	__esModule: true,
	store: 'core/editor',
} ) );

jest.mock( '../../../src/components/DocumentPropertiesActions', () => ( {
	__esModule: true,
	default: () => null,
} ) );

// The traits additions pull in core-data/apiFetch; stub them here so these
// tests stay focused on the source collection's properties and layout editing.
jest.mock( '../../../src/hooks/useDocumentTraits', () => ( {
	__esModule: true,
	default: ( documentId ) => {
		mockTraitsDocumentId = documentId;
		return mockTraits;
	},
} ) );

jest.mock( '../../../src/components/TraitControl', () => {
	const ActualTraitControl = jest.requireActual(
		'../../../src/components/TraitControl'
	).default;
	return {
		__esModule: true,
		default: ( props ) => {
			mockTraitControlProps = props;
			return mockUseActualTraitControl ? (
				<ActualTraitControl { ...props } />
			) : (
				<div data-testid="trait-control" />
			);
		},
	};
} );

jest.mock( '../../../src/components/AdditionalCollectionProperties', () => {
	const { useEffect } = require( '@wordpress/element' );
	return {
		__esModule: true,
		default: function MockAdditionalCollectionProperties( {
			collection,
			includeSystemFields,
			onVisibleCount,
			registerPendingSaveFlusher,
			renderProperties,
		} ) {
			const count = mockAdditionalCounts[ collection.id ] ?? 0;
			mockAdditionalProps[ collection.id ] = {
				includeSystemFields,
				renderProperties,
				registerPendingSaveFlusher,
			};
			useEffect( () => {
				onVisibleCount?.( collection.id, count );
			}, [ collection.id, count, onVisibleCount ] );
			return renderProperties ? <div>{ collection.title }</div> : null;
		},
		CollectionGroupHeader: () => null,
	};
} );

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
				<button
					type="button"
					onClick={ () => {
						if (
							props.isSaveLocked ||
							props.isCollectionSaveLocked?.( props.collectionId )
						) {
							return;
						}
						mockFieldSave();
					} }
				>
					Edit mocked property
				</button>
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
import apiFetch from '@wordpress/api-fetch';

const fields = [
	{ id: 'title', label: 'Title' },
	{ id: 'field-10', label: 'Author' },
	{ id: 'created_at', label: 'Created' },
];
const allFields = [ ...fields, { id: 'field-11', label: 'Hidden field' } ];

beforeEach( () => {
	mockCanEdit = true;
	mockCanEditById = null;
	mockIsSaving = false;
	mockPostStatus = 'private';
	mockSaveEntityRecord = jest.fn().mockResolvedValue( {} );
	mockRowPropertiesProps = null;
	mockTraitControlProps = null;
	mockUseActualTraitControl = false;
	mockFieldSave = jest.fn();
	apiFetch.mockReset();
	mockTraits = {
		collections: [ { id: 77, title: 'Projects', icon: '' } ],
		isResolving: false,
		isUnknown: false,
		refresh: jest.fn(),
	};
	mockTraitsDocumentId = null;
	mockAdditionalCounts = {};
	mockAdditionalProps = {};
	mockPreviousClientId = 'title-block';
	mockSelectBlock = jest.fn();
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

afterEach( () => {} );

describe( 'document-properties Customize properties mode', () => {
	it( 'mounts the membership control on a row', () => {
		render( <Edit /> );

		expect( mockTraitsDocumentId ).toBe( 123 );
		expect( screen.getByTestId( 'trait-control' ) ).toBeInTheDocument();
		expect( mockTraitControlProps.isReadOnly ).toBe( false );
	} );

	it( 'makes the trait control read-only on an archived row', () => {
		mockPostStatus = 'crtxt_archived';

		render( <Edit /> );

		expect( mockTraitControlProps.isReadOnly ).toBe( true );
	} );

	it( 'coordinates a collection property flush with the membership control', async () => {
		const flush = jest.fn().mockResolvedValue( true );
		render( <Edit /> );

		const unregister = mockRowPropertiesProps.registerPendingSaveFlusher(
			77,
			flush
		);
		let preparation;
		act( () => {
			preparation = mockTraitControlProps.beforeRemoveCollection( 77 );
			// The ref-backed lock is visible synchronously, before React has had a
			// chance to rerender RowProperties as read-only.
			expect( mockRowPropertiesProps.isCollectionSaveLocked( 77 ) ).toBe(
				true
			);
		} );
		let release;
		await act( async () => {
			release = await preparation;
		} );

		expect( flush ).toHaveBeenCalledTimes( 1 );
		expect( mockRowPropertiesProps.isSaveLocked ).toBe( true );
		act( () => release() );
		expect( mockRowPropertiesProps.isCollectionSaveLocked( 77 ) ).toBe(
			false
		);
		await waitFor( () =>
			expect( mockRowPropertiesProps.isSaveLocked ).toBe( false )
		);
		unregister();
		let releaseWithoutFields;
		await act( async () => {
			releaseWithoutFields =
				await mockTraitControlProps.beforeRemoveCollection( 77 );
		} );
		act( () => releaseWithoutFields() );
	} );

	it( 'keeps field edits locked from remove click until the membership PUT settles', async () => {
		mockUseActualTraitControl = true;
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '', active: true },
				{ id: 88, title: 'People', icon: '', active: true },
			],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};
		let resolveFlush;
		let resolvePut;
		const pendingFlush = new Promise( ( resolve ) => {
			resolveFlush = resolve;
		} );
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					resolvePut = resolve;
				} )
		);
		render( <Edit /> );
		mockRowPropertiesProps.registerPendingSaveFlusher(
			77,
			() => pendingFlush
		);

		fireEvent.click( screen.getAllByLabelText( 'Remove trait' )[ 0 ] );
		expect( mockRowPropertiesProps.isCollectionSaveLocked( 77 ) ).toBe(
			true
		);
		expect( apiFetch ).not.toHaveBeenCalled();

		await act( async () => resolveFlush( true ) );
		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( mockRowPropertiesProps.isSaveLocked ).toBe( true );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit mocked property' } )
		);
		expect( mockFieldSave ).not.toHaveBeenCalled();

		await act( async () =>
			resolvePut( { collections: [ { id: 88, active: true } ] } )
		);
		await waitFor( () =>
			expect( mockRowPropertiesProps.isSaveLocked ).toBe( false )
		);
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Edit mocked property' } )
		);
		expect( mockFieldSave ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'waits for an orphaned collapse save after expanding before membership removal', async () => {
		let resolveOrphanedSave;
		let resolveExpandedSave;
		const orphanedSave = new Promise( ( resolve ) => {
			resolveOrphanedSave = resolve;
		} );
		const expandedSave = new Promise( ( resolve ) => {
			resolveExpandedSave = resolve;
		} );
		const { rerender } = render( <Edit /> );
		const unregisterCollapsedGroup =
			mockRowPropertiesProps.registerPendingSaveFlusher( 77, jest.fn() );

		mockContext = { ...mockContext, isVisible: false };
		rerender( <Edit /> );
		unregisterCollapsedGroup( orphanedSave );

		mockContext = { ...mockContext, isVisible: true };
		rerender( <Edit /> );
		const expandedFlush = jest.fn( () => expandedSave );
		mockRowPropertiesProps.registerPendingSaveFlusher( 77, expandedFlush );

		let removalBarrier;
		act( () => {
			removalBarrier = mockTraitControlProps.beforeRemoveCollection( 77 );
		} );
		let barrierSettled = false;
		removalBarrier.then( () => {
			barrierSettled = true;
		} );
		await Promise.resolve();

		expect( expandedFlush ).not.toHaveBeenCalled();
		expect( barrierSettled ).toBe( false );

		act( () => resolveOrphanedSave() );
		await waitFor( () => expect( expandedFlush ).toHaveBeenCalled() );
		expect( barrierSettled ).toBe( false );

		let release;
		await act( async () => {
			resolveExpandedSave();
			release = await removalBarrier;
		} );
		expect( barrierSettled ).toBe( true );
		act( () => release() );
	} );

	it( 'rejects membership removal when an orphaned collapse save failed', async () => {
		let rejectOrphanedSave;
		const orphanedSave = new Promise( ( resolve, reject ) => {
			rejectOrphanedSave = reject;
		} );
		render( <Edit /> );
		const unregisterCollapsedGroup =
			mockRowPropertiesProps.registerPendingSaveFlusher( 77, jest.fn() );
		unregisterCollapsedGroup( orphanedSave );
		mockRowPropertiesProps.registerPendingSaveFlusher(
			77,
			jest.fn().mockResolvedValue( true )
		);

		let removalBarrier;
		act( () => {
			removalBarrier = mockTraitControlProps.beforeRemoveCollection( 77 );
		} );
		await act( async () => {
			rejectOrphanedSave( new Error( 'Status could not be saved.' ) );
			await expect( removalBarrier ).rejects.toThrow(
				'Status could not be saved.'
			);
		} );
		expect( mockRowPropertiesProps.isCollectionSaveLocked( 77 ) ).toBe(
			false
		);
		// The rejection is consumed after being reported, so a deliberate retry
		// can proceed instead of permanently locking the membership.
		let release;
		await act( async () => {
			release = await mockTraitControlProps.beforeRemoveCollection( 77 );
		} );
		act( () => release() );
	} );

	it( 'keeps traits usable when the source collection has no properties', () => {
		mockContext = {
			...mockContext,
			fields: [],
			allFields: [],
			detailLayoutEntries: [],
		};
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '' },
				{ id: 88, title: 'People', icon: '' },
			],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};

		render( <Edit /> );

		expect( screen.getByTestId( 'trait-control' ) ).toBeInTheDocument();
		expect( screen.getByText( 'People' ) ).toBeInTheDocument();
	} );

	it( 'keeps the memberships retry notice when the source has no properties', () => {
		const refresh = jest.fn();
		mockContext = {
			...mockContext,
			fields: [],
			allFields: [],
			detailLayoutEntries: [],
		};
		mockTraits = {
			collections: [],
			isResolving: false,
			isUnknown: true,
			error: new Error( 'Network error' ),
			refresh,
		};

		render( <Edit /> );

		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			"Couldn't load the collections for this item."
		);
		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );
		expect( refresh ).toHaveBeenCalled();
	} );

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
			new Error( "Couldn't update layout." )
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
			"Couldn't update layout."
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

	it( 'resolves additional collection counts while collapsed', async () => {
		mockContext = { ...mockContext, isVisible: false };
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '' },
				{ id: 88, title: 'People', icon: '' },
			],
			isResolving: false,
			refresh: jest.fn(),
		};
		mockAdditionalCounts = { 88: 3 };

		render( <Edit /> );

		expect(
			await screen.findByRole( 'button', {
				name: '5 properties collapsed',
			} )
		).toBeInTheDocument();
		expect( screen.queryByText( 'People' ) ).not.toBeInTheDocument();
	} );

	it( 'hides stale source handlers while removing the source membership', async () => {
		const onLayoutEditingChange = jest.fn();
		mockContext = { ...mockContext, onLayoutEditingChange };
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '' },
				{ id: 88, title: 'People', icon: '' },
			],
			isResolving: false,
			refresh: jest.fn(),
		};
		const { rerender } = render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		expect(
			screen.getByRole( 'button', { name: 'Done customizing' } )
		).toBeInTheDocument();

		mockTraits = {
			collections: [],
			isResolving: true,
			refresh: jest.fn(),
		};
		rerender( <Edit /> );

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Done customizing' } )
		).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Customize properties' } )
		).toBeNull();
		await waitFor( () =>
			expect( onLayoutEditingChange ).toHaveBeenLastCalledWith( false )
		);

		mockAdditionalProps = {};
		mockTraits = {
			collections: [
				{ id: 88, title: 'People', icon: '' },
				{ id: 99, title: 'Goals', icon: '' },
			],
			isResolving: false,
			refresh: jest.fn(),
		};
		rerender( <Edit /> );

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		expect( screen.getByText( 'People' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Goals' ) ).toBeInTheDocument();
		expect( mockAdditionalProps[ 88 ].includeSystemFields ).toBe( true );
		expect( mockAdditionalProps[ 99 ].includeSystemFields ).toBe( false );
	} );

	it( 'does not authorize layout editing from a removed editable source', () => {
		mockCanEditById = { 77: true, 88: false };
		const onLayoutEditingChange = jest.fn();
		mockContext = {
			...mockContext,
			layoutEditRequest: 1,
			onLayoutEditingChange,
		};
		mockTraits = {
			collections: [ { id: 88, title: 'People', icon: '' } ],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};

		render( <Edit /> );

		expect( screen.getByText( 'People' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Customize properties' } )
		).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Done customizing' } )
		).toBeNull();
		expect( onLayoutEditingChange ).not.toHaveBeenCalledWith( true );
	} );

	it( 'authorizes layout editing from an editable surviving membership', async () => {
		mockCanEditById = { 77: false, 88: true };
		mockContext = { ...mockContext, layoutEditRequest: 1 };
		mockTraits = {
			collections: [ { id: 88, title: 'People', icon: '' } ],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};

		render( <Edit /> );

		expect(
			await screen.findByRole( 'button', { name: 'Done customizing' } )
		).toBeInTheDocument();
	} );

	it( 'keeps membership-backed UI hidden after a failed refresh', async () => {
		const onLayoutEditingChange = jest.fn();
		mockContext = { ...mockContext, onLayoutEditingChange };
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '' },
				{ id: 88, title: 'People', icon: '' },
			],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};
		const { rerender } = render( <Edit /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Customize properties' } )
		);
		mockTraits = {
			collections: [],
			isResolving: false,
			isUnknown: true,
			error: new Error( 'refresh failed' ),
			refresh: jest.fn(),
		};
		rerender( <Edit /> );

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		expect( screen.queryByText( 'People' ) ).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Customize properties' } )
		).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Done customizing' } )
		).toBeNull();
		await waitFor( () =>
			expect( onLayoutEditingChange ).toHaveBeenLastCalledWith( false )
		);
	} );

	it( 'hides the stale source when a resolved row has no memberships', () => {
		mockTraits = {
			collections: [],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};

		render( <Edit /> );

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		expect(
			screen.queryByRole( 'button', { name: 'Customize properties' } )
		).toBeNull();
	} );

	it( 'does not render a property group for a trashed membership', () => {
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '', active: true },
				{ id: 88, title: 'People', icon: '', active: false },
			],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};
		mockAdditionalCounts = { 88: 3 };

		render( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'People' ) ).toBeNull();
		expect( screen.getByTestId( 'trait-control' ) ).toBeInTheDocument();
	} );

	it( 'hides the source group when the source membership is trashed', () => {
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '', active: false },
				{ id: 88, title: 'People', icon: '', active: true },
			],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};

		render( <Edit /> );

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		expect( screen.getByText( 'People' ) ).toBeInTheDocument();
		expect( mockAdditionalProps[ 88 ].includeSystemFields ).toBe( true );
	} );

	it( 'keeps showing the collections of a row retired together with them', () => {
		mockTraits = {
			collections: [
				{ id: 77, title: 'Projects', icon: '', active: false },
				{ id: 88, title: 'People', icon: '', active: false },
			],
			isResolving: false,
			isUnknown: false,
			refresh: jest.fn(),
		};

		render( <Edit /> );

		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
		expect( mockAdditionalProps[ 88 ] ).toBeDefined();
	} );

	it( 'offers a retry when the traits request fails', () => {
		const refresh = jest.fn();
		mockTraits = {
			collections: [],
			isResolving: false,
			isUnknown: true,
			error: new Error( 'load failed' ),
			refresh,
		};

		render( <Edit /> );

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			"Couldn't load the collections for this item."
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		expect( refresh ).toHaveBeenCalled();
	} );
} );

describe( 'document-properties selection', () => {
	it( 'hands the selection to the previous block when it shows nothing', () => {
		mockContext = {
			...mockContext,
			rowId: null,
			fields: [],
			allFields: [],
		};

		const { container } = render(
			<Edit clientId="properties-block" isSelected />
		);

		expect( container ).toBeEmptyDOMElement();
		expect( mockSelectBlock ).toHaveBeenCalledWith( 'title-block', -1 );
	} );

	it( 'keeps the selection when it shows properties', () => {
		render( <Edit clientId="properties-block" isSelected /> );

		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
		expect( mockSelectBlock ).not.toHaveBeenCalled();
	} );

	it( 'keeps the selection when it only shows the traits row', () => {
		mockContext = { ...mockContext, fields: [], allFields: [] };

		render( <Edit clientId="properties-block" isSelected /> );

		expect( screen.getByTestId( 'trait-control' ) ).toBeInTheDocument();
		expect( mockSelectBlock ).not.toHaveBeenCalled();
	} );

	it( 'leaves the selection alone while another block is selected', () => {
		mockContext = {
			...mockContext,
			rowId: null,
			fields: [],
			allFields: [],
		};

		render( <Edit clientId="properties-block" isSelected={ false } /> );

		expect( mockSelectBlock ).not.toHaveBeenCalled();
	} );
} );
