/**
 * Tests for `src/components/AdditionalCollectionProperties.js`: a non-source
 * collection's property group for a multi-collection row. It is
 * editable (shares the layout-editing toggle) and reports its visible field
 * count so the block's collapse summary can total every collection.
 */

import { render, screen } from '@testing-library/react';

let mockFields;
let mockLayout;
let mockLayoutArgs;
let mockRowPropertiesProps;

jest.mock( '../../../src/hooks/useCollectionFields', () => ( {
	__esModule: true,
	default: () => mockFields,
} ) );

jest.mock( '../../../src/hooks/useDetailLayoutEditing', () => ( {
	__esModule: true,
	default: ( args ) => {
		mockLayoutArgs = args;
		return mockLayout;
	},
} ) );

jest.mock( '../../../src/components/RowProperties', () => ( {
	__esModule: true,
	default: ( props ) => {
		mockRowPropertiesProps = props;
		return <div data-testid="row-properties" />;
	},
} ) );

jest.mock( '../../../src/components/DocumentIcon', () => ( {
	__esModule: true,
	default: () => null,
} ) );

jest.mock( '../../../src/components/CollectionFieldsContext', () => ( {
	__esModule: true,
	CollectionFieldsSnapshotProvider: ( { children } ) => <>{ children }</>,
} ) );

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Notice: ( { children } ) => <div role="alert">{ children }</div>,
} ) );

import AdditionalCollectionProperties from '../../../src/components/AdditionalCollectionProperties';

beforeEach( () => {
	mockFields = {
		detailFields: [ { id: 'field-1', label: 'A' } ],
		allDetailFields: [ { id: 'field-1', label: 'A' } ],
		detailLayoutEntries: undefined,
		isResolving: false,
	};
	mockLayout = {
		propertyFieldsForDisplay: [ { id: 'field-1', label: 'A' } ],
		layoutReorderHandler: jest.fn(),
		layoutVisibilityHandler: jest.fn(),
		showEmptyProperties: false,
		isLayoutEditingEnabled: true,
		saveError: null,
		visiblePropertyCount: 1,
		hasLayoutProperties: true,
	};
	mockRowPropertiesProps = undefined;
	mockLayoutArgs = undefined;
} );

describe( 'AdditionalCollectionProperties', () => {
	it( 'renders the collection header and an editable RowProperties', () => {
		const isCollectionSaveLocked = jest.fn().mockReturnValue( true );
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				isCollectionSaveLocked={ isCollectionSaveLocked }
				isSaveLocked
				rowId={ 5 }
				row={ {} }
				isLayoutEditing={ true }
				onVisibleCount={ () => {} }
			/>
		);

		expect( screen.getByText( 'People' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
		expect( mockRowPropertiesProps.collectionId ).toBe( 7 );
		expect( mockRowPropertiesProps.isLayoutEditing ).toBe( true );
		expect( mockRowPropertiesProps.isSaveLocked ).toBe( true );
		expect( mockRowPropertiesProps.isCollectionSaveLocked ).toBe(
			isCollectionSaveLocked
		);
		expect( typeof mockRowPropertiesProps.onLayoutReorder ).toBe(
			'function'
		);
		expect( typeof mockRowPropertiesProps.onLayoutVisibilityToggle ).toBe(
			'function'
		);
	} );

	it( 'reports its visible property count', () => {
		const onVisibleCount = jest.fn();
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				onVisibleCount={ onVisibleCount }
			/>
		);

		expect( onVisibleCount ).toHaveBeenCalledWith( 7, 1 );
	} );

	it( 'resolves counts without rendering a collapsed group', () => {
		const onVisibleCount = jest.fn();
		const { container } = render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				onVisibleCount={ onVisibleCount }
				renderProperties={ false }
			/>
		);

		expect( container ).toBeEmptyDOMElement();
		expect( onVisibleCount ).toHaveBeenCalledWith( 7, 1 );
	} );

	it( 'does not render or report a count until fields resolve', () => {
		mockFields = { ...mockFields, isResolving: true };
		const onVisibleCount = jest.fn();
		const { container, rerender } = render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				onVisibleCount={ onVisibleCount }
			/>
		);

		expect( container ).toBeEmptyDOMElement();
		expect( onVisibleCount ).not.toHaveBeenCalled();

		mockFields = { ...mockFields, isResolving: false };
		rerender(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				onVisibleCount={ onVisibleCount }
			/>
		);

		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
		expect( onVisibleCount ).toHaveBeenCalledWith( 7, 1 );
	} );

	it( 'excludes document-level system fields from secondary groups', () => {
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
			/>
		);

		expect( mockLayoutArgs.excludedFieldIds ).toEqual(
			expect.objectContaining( {
				has: expect.any( Function ),
			} )
		);
		expect( mockLayoutArgs.excludedFieldIds.has( 'created_at' ) ).toBe(
			true
		);
		expect( mockLayoutArgs.excludedFieldIds.has( 'modified_by' ) ).toBe(
			true
		);
	} );

	it( 'includes system fields when designated as their sole owner', () => {
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				includeSystemFields
			/>
		);

		expect( mockLayoutArgs.excludedFieldIds ).toBeUndefined();
	} );

	it( 'renders nothing when the collection has no layout properties', () => {
		mockLayout = { ...mockLayout, hasLayoutProperties: false };
		const { container } = render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				onVisibleCount={ () => {} }
			/>
		);

		expect( container ).toBeEmptyDOMElement();
	} );
} );
