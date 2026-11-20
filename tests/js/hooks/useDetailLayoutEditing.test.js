import { act, renderHook, waitFor } from '@testing-library/react';

let mockCanEdit;
let mockIsSaving;
let mockSaveEntityRecord;

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

jest.mock( '../../../src/components/RowProperties', () => ( {
	__esModule: true,
	HIDDEN_PROPERTIES_DROP_TARGET: 'hidden-properties',
} ) );

jest.mock( '../../../src/components/dataViewColumns', () => ( {
	__esModule: true,
	TITLE_FIELD_ID: 'title',
} ) );

import useDetailLayoutEditing from '../../../src/hooks/useDetailLayoutEditing';

const customField = { id: 'field-1', label: 'Status' };
const createdField = { id: 'created_at', label: 'Created' };
const systemFieldIds = new Set( [ 'created_at' ] );

beforeEach( () => {
	mockCanEdit = true;
	mockIsSaving = false;
	mockSaveEntityRecord = jest.fn().mockResolvedValue( {} );
} );

describe( 'useDetailLayoutEditing', () => {
	it( 'hides excluded system fields but preserves them when saving', async () => {
		const { result } = renderHook( () =>
			useDetailLayoutEditing( {
				collectionId: 7,
				fields: [ customField, createdField ],
				allFields: [ customField, createdField ],
				detailLayoutEntries: [
					{ field: 'field-1', visible: true },
					{ field: 'created_at', visible: true },
				],
				rowId: 5,
				isLayoutEditing: true,
				excludedFieldIds: systemFieldIds,
			} )
		);

		expect(
			result.current.propertyFieldsForDisplay.map( ( field ) => field.id )
		).toEqual( [ 'field-1' ] );
		expect( result.current.visiblePropertyCount ).toBe( 1 );

		act( () => result.current.layoutVisibilityHandler( 'field-1' ) );
		expect( result.current.visiblePropertyCount ).toBe( 0 );
		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledWith(
				'postType',
				'crtxt_document',
				{
					id: 7,
					meta: {
						cortext_detail_layout: {
							fields: [
								{ field: 'field-1', visible: false },
								{ field: 'created_at', visible: true },
							],
						},
					},
				},
				{ throwOnError: true }
			)
		);
	} );

	it( 'keeps accepting customize-mode edits while a layout save is in flight', async () => {
		mockIsSaving = true;
		const ownerField = { id: 'field-2', label: 'Owner' };
		const { result } = renderHook( () =>
			useDetailLayoutEditing( {
				collectionId: 7,
				fields: [ customField, ownerField ],
				allFields: [ customField, ownerField ],
				detailLayoutEntries: [
					{ field: 'field-1', visible: true },
					{ field: 'field-2', visible: true },
				],
				rowId: 5,
				isLayoutEditing: true,
			} )
		);

		act( () => result.current.layoutVisibilityHandler( 'field-1' ) );
		act( () =>
			result.current.layoutReorderHandler( 'field-2', 'field-1' )
		);

		await waitFor( () =>
			expect( mockSaveEntityRecord ).toHaveBeenCalledTimes( 2 )
		);
	} );

	it( 'does not expose editing handlers without collection permission', () => {
		mockCanEdit = false;
		const { result } = renderHook( () =>
			useDetailLayoutEditing( {
				collectionId: 7,
				fields: [ customField ],
				allFields: [ customField ],
				detailLayoutEntries: [ { field: 'field-1', visible: true } ],
				rowId: 5,
				isLayoutEditing: true,
			} )
		);

		expect( result.current.isLayoutEditingEnabled ).toBe( false );
		expect( result.current.layoutReorderHandler ).toBeUndefined();
		expect( result.current.layoutVisibilityHandler ).toBeUndefined();
		expect( mockSaveEntityRecord ).not.toHaveBeenCalled();
	} );

	it( 'does not count a group containing only document system fields', () => {
		const { result } = renderHook( () =>
			useDetailLayoutEditing( {
				collectionId: 7,
				fields: [ createdField ],
				allFields: [ createdField ],
				detailLayoutEntries: [ { field: 'created_at', visible: true } ],
				rowId: 5,
				isLayoutEditing: false,
				excludedFieldIds: systemFieldIds,
			} )
		);

		expect( result.current.visiblePropertyCount ).toBe( 0 );
		expect( result.current.hasLayoutProperties ).toBe( false );
	} );

	it( 'counts system fields when the group owns document properties', () => {
		const { result } = renderHook( () =>
			useDetailLayoutEditing( {
				collectionId: 7,
				fields: [ createdField ],
				allFields: [ createdField ],
				detailLayoutEntries: [ { field: 'created_at', visible: true } ],
				rowId: 5,
				isLayoutEditing: false,
			} )
		);

		expect( result.current.visiblePropertyCount ).toBe( 1 );
		expect( result.current.hasLayoutProperties ).toBe( true );
		expect( result.current.propertyFieldsForDisplay ).toEqual( [
			createdField,
		] );
	} );
} );
