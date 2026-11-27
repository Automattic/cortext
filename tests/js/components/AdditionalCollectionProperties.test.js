/**
 * Tests for `src/components/AdditionalCollectionProperties.js`: a non-source
 * collection's property group for a multi-collection row. It is editable
 * (shares the layout-editing toggle), folds under its trait header, and offers
 * to remove the trait.
 */

import { fireEvent, render, screen } from '@testing-library/react';

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
	default: ( { icon } ) => <span data-testid="icon" data-icon={ icon } />,
} ) );

jest.mock( '../../../src/components/CollectionFieldsContext', () => ( {
	__esModule: true,
	CollectionFieldsSnapshotProvider: ( { children } ) => <>{ children }</>,
} ) );

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Button: ( { children, label, onClick, 'aria-expanded': expanded } ) => (
		<button
			type="button"
			aria-label={ label }
			aria-expanded={ expanded }
			onClick={ onClick }
		>
			{ children }
		</button>
	),
	Dropdown: ( { renderContent, renderToggle } ) => (
		<div>
			{ renderToggle( { isOpen: true, onToggle: () => {} } ) }
			{ renderContent( { onClose: () => {} } ) }
		</div>
	),
	MenuGroup: ( { children } ) => <div>{ children }</div>,
	MenuItem: ( { children, disabled, onClick } ) => (
		<button
			type="button"
			role="menuitem"
			disabled={ disabled }
			onClick={ onClick }
		>
			{ children }
		</button>
	),
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

	it( 'folds under its header and shows the count while folded', () => {
		const onToggleCollapsed = jest.fn();
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				isCollapsed
				onToggleCollapsed={ onToggleCollapsed }
			/>
		);

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		const toggle = screen.getByRole( 'button', { name: /^People/ } );
		expect( toggle ).toHaveAttribute( 'aria-expanded', 'false' );
		expect( screen.getByLabelText( '1 property' ) ).toBeInTheDocument();

		fireEvent.click( toggle );
		expect( onToggleCollapsed ).toHaveBeenCalledWith( 7 );
	} );

	it( 'stays open while customizing the layout', () => {
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				isCollapsed
				isLayoutEditing
				onRemove={ jest.fn() }
				onToggleCollapsed={ jest.fn() }
			/>
		);

		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: /^People/ } )
		).toBeNull();
		expect( screen.queryByRole( 'menuitem' ) ).toBeNull();
	} );

	it( 'folds with the block even while customizing the layout', () => {
		const onToggleCollapsed = jest.fn();
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				isBlockCollapsed
				isLayoutEditing
				onToggleCollapsed={ onToggleCollapsed }
			/>
		);

		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		fireEvent.click( screen.getByRole( 'button', { name: /^People/ } ) );
		expect( onToggleCollapsed ).toHaveBeenCalledWith( 7 );
	} );

	it( 'shows the collection glyph when the collection has no icon', () => {
		const { rerender } = render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
			/>
		);

		expect( screen.getByTestId( 'icon' ) ).toHaveAttribute(
			'data-icon',
			JSON.stringify( { type: 'wp', name: 'collection' } )
		);

		rerender(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '🎭' } }
				rowId={ 5 }
				row={ {} }
			/>
		);

		expect( screen.getByTestId( 'icon' ) ).toHaveAttribute(
			'data-icon',
			'🎭'
		);
	} );

	it( 'renders the system properties after itself when it owns them', () => {
		mockLayout = {
			...mockLayout,
			propertyFieldsForDisplay: [
				{ id: 'field-1', label: 'A' },
				{ id: 'created_at', label: 'Created' },
			],
		};
		const { container } = render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				includeSystemFields
			/>
		);

		const lists = screen.getAllByTestId( 'row-properties' );
		expect( lists ).toHaveLength( 2 );
		expect(
			container.querySelector( '.cortext-property-group--system' )
		).toContainElement( lists[ 1 ] );
		expect(
			mockRowPropertiesProps.fields.map( ( field ) => field.id )
		).toEqual( [ 'created_at' ] );
	} );

	it( 'removes its trait from the header menu', () => {
		const onRemove = jest.fn();
		const collection = { id: 7, title: 'People', icon: '' };
		render(
			<AdditionalCollectionProperties
				collection={ collection }
				rowId={ 5 }
				row={ {} }
				onRemove={ onRemove }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'menuitem', { name: 'Remove trait' } )
		);
		expect( onRemove ).toHaveBeenCalledWith( collection );
	} );

	it( 'renders nothing while hidden for a membership refresh', () => {
		const { container } = render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				showGroup={ false }
			/>
		);

		expect( container ).toBeEmptyDOMElement();
	} );

	it( 'renders nothing until fields resolve', () => {
		mockFields = { ...mockFields, isResolving: true };
		const { container, rerender } = render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
			/>
		);

		expect( container ).toBeEmptyDOMElement();

		mockFields = { ...mockFields, isResolving: false };
		rerender(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
			/>
		);

		expect( screen.getByTestId( 'row-properties' ) ).toBeInTheDocument();
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

	it( 'keeps only its header when the collection has no properties of its own', () => {
		mockFields = {
			...mockFields,
			detailFields: [],
			allDetailFields: [ { id: 'title', label: 'Title' } ],
		};
		mockLayout = {
			...mockLayout,
			propertyFieldsForDisplay: [],
			hasLayoutProperties: false,
		};
		render(
			<AdditionalCollectionProperties
				collection={ { id: 7, title: 'People', icon: '' } }
				rowId={ 5 }
				row={ {} }
				onToggleCollapsed={ jest.fn() }
			/>
		);

		expect( screen.getByText( 'People' ) ).toBeInTheDocument();
		expect( screen.queryByTestId( 'row-properties' ) ).toBeNull();
		// Nothing to fold.
		expect(
			screen.queryByRole( 'button', { name: /^People/ } )
		).toBeNull();
	} );
} );
