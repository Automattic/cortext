/**
 * Tests for `src/components/AddTraitControl.js`: the "Add trait" picker after a
 * row's property groups. It searches collections on the server and hands the
 * pick to its caller, which owns the write.
 */

import { fireEvent, render, screen } from '@testing-library/react';

let mockAllCollections;
let mockCollectionQuery;
let mockTotalPages;

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	store: {},
	useEntityRecords: ( kind, name, query ) => {
		mockCollectionQuery = query;
		return {
			records:
				typeof mockAllCollections === 'function'
					? mockAllCollections( query )
					: mockAllCollections,
			isResolving: false,
			totalPages: mockTotalPages,
		};
	},
} ) );

jest.mock( '@wordpress/components', () => {
	const { forwardRef } = require( 'react' );
	return {
		__esModule: true,
		Button: forwardRef( ( { children, label, onClick, disabled }, ref ) => (
			<button
				ref={ ref }
				type="button"
				aria-label={ label }
				disabled={ disabled }
				onClick={ onClick }
			>
				{ children ?? label }
			</button>
		) ),
		Popover: ( { children } ) => <div>{ children }</div>,
		SearchControl: ( { value, onChange, placeholder } ) => (
			<input
				aria-label={ placeholder }
				value={ value }
				onChange={ ( event ) => onChange( event.target.value ) }
			/>
		),
		Spinner: () => <span>loading</span>,
	};
} );

jest.mock( '../../../src/components/DocumentIcon', () => ( {
	__esModule: true,
	default: ( { icon } ) => <span data-testid="icon" data-icon={ icon } />,
} ) );

import AddTraitControl from '../../../src/components/AddTraitControl';

beforeEach( () => {
	mockAllCollections = [];
	mockCollectionQuery = undefined;
	mockTotalPages = 1;
} );

function renderControl( props = {} ) {
	const onAdd = jest.fn();
	render(
		<AddTraitControl
			currentIds={ new Set( [ 1 ] ) }
			onAdd={ onAdd }
			{ ...props }
		/>
	);
	return onAdd;
}

describe( 'AddTraitControl', () => {
	it( 'hands the picked collection to the caller and closes', () => {
		mockAllCollections = [ { id: 3, title: { raw: 'Goals' }, meta: {} } ];
		const onAdd = renderControl();

		fireEvent.click( screen.getByText( 'Add trait' ) );
		fireEvent.click( screen.getByText( 'Goals' ) );

		expect( onAdd ).toHaveBeenCalledWith( mockAllCollections[ 0 ] );
		expect( screen.queryByLabelText( 'Search traits' ) ).toBeNull();
	} );

	it( 'shows the collection glyph for a collection without an icon', () => {
		mockAllCollections = [
			{ id: 3, title: { raw: 'Goals' }, meta: {} },
			{
				id: 4,
				title: { raw: 'Ideas' },
				meta: { cortext_document_icon: '💡' },
			},
		];
		renderControl();

		fireEvent.click( screen.getByText( 'Add trait' ) );

		const icons = screen.getAllByTestId( 'icon' );
		expect( icons[ 0 ] ).toHaveAttribute(
			'data-icon',
			JSON.stringify( { type: 'wp', name: 'collection' } )
		);
		expect( icons[ 1 ] ).toHaveAttribute( 'data-icon', '💡' );
	} );

	it( 'omits collections the row already belongs to from suggestions', () => {
		mockAllCollections = [
			{ id: 1, title: { raw: 'Projects' }, meta: {} },
			{ id: 3, title: { raw: 'Goals' }, meta: {} },
		];
		renderControl();

		fireEvent.click( screen.getByText( 'Add trait' ) );

		expect( screen.getByText( 'Goals' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Projects' ) ).toBeNull();
	} );

	it( 'disables the button while a write is in flight', () => {
		renderControl( { isSaving: true } );

		expect( screen.getByText( 'Add trait' ) ).toBeDisabled();
		expect( screen.getByText( 'loading' ) ).toBeInTheDocument();
	} );

	it( 'shows the last write error', () => {
		renderControl( { error: 'Membership failed.' } );

		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			'Membership failed.'
		);
	} );

	it( 'searches collections on the server instead of a local first page', async () => {
		const emptyResults = [];
		const searchResults = [
			{ id: 123, title: { raw: 'Remote archive' }, meta: {} },
		];
		mockAllCollections = ( query ) =>
			query.search === 'Remote' ? searchResults : emptyResults;
		renderControl();

		fireEvent.click( screen.getByText( 'Add trait' ) );
		fireEvent.change( screen.getByLabelText( 'Search traits' ), {
			target: { value: 'Remote' },
		} );

		expect(
			await screen.findByText( 'Remote archive' )
		).toBeInTheDocument();
		expect( mockCollectionQuery ).toEqual(
			expect.objectContaining( {
				cortext_collections: 1,
				page: 1,
				per_page: 20,
				search: 'Remote',
			} )
		);
	} );

	it( 'loads later result pages', async () => {
		const firstPage = [
			{ id: 21, title: { raw: 'First page' }, meta: {} },
		];
		const secondPage = [
			{ id: 22, title: { raw: 'Second page' }, meta: {} },
		];
		mockTotalPages = 2;
		mockAllCollections = ( query ) =>
			query.page === 2 ? secondPage : firstPage;
		renderControl();

		fireEvent.click( screen.getByText( 'Add trait' ) );
		expect( await screen.findByText( 'First page' ) ).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Load more traits' } )
		);

		expect( await screen.findByText( 'Second page' ) ).toBeInTheDocument();
		expect( screen.getByText( 'First page' ) ).toBeInTheDocument();
		expect( mockCollectionQuery.page ).toBe( 2 );
	} );
} );
