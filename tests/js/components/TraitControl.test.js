/**
 * Tests for `src/components/TraitControl.js`: the membership chips in the
 * item detail. Adding/removing writes the new set through the traits endpoint
 * and the last membership cannot be removed.
 */

import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';

let mockAllCollections;
let mockCollectionQuery;
let mockTotalPages;

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

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

const mockInvalidate = jest.fn();
jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: () => ( { invalidateResolution: mockInvalidate } ),
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
	default: () => null,
} ) );

const mockNotify = jest.fn();
jest.mock( '../../../src/hooks/rowInvalidation', () => ( {
	__esModule: true,
	notifyCollectionRowsChanged: ( ...args ) => mockNotify( ...args ),
} ) );

const mockNotifyLocatorChanged = jest.fn();
jest.mock( '../../../src/hooks/documentLocatorInvalidation', () => ( {
	__esModule: true,
	notifyDocumentLocatorChanged: ( ...args ) =>
		mockNotifyLocatorChanged( ...args ),
} ) );

import apiFetch from '@wordpress/api-fetch';
import TraitControl from '../../../src/components/TraitControl';

function membership( id, title ) {
	return { id, title, path: `${ title }-${ id }`, icon: '' };
}

beforeEach( () => {
	apiFetch.mockReset();
	apiFetch.mockResolvedValue( { collections: [] } );
	mockNotify.mockReset();
	mockNotifyLocatorChanged.mockReset();
	mockInvalidate.mockReset();
	mockAllCollections = [];
	mockCollectionQuery = undefined;
	mockTotalPages = 1;
} );

describe( 'TraitControl', () => {
	it( 'hides remove on the last membership', () => {
		render(
			<TraitControl
				documentId={ 5 }
				collections={ [ membership( 1, 'Projects' ) ] }
				onChange={ () => {} }
			/>
		);

		expect( screen.queryByLabelText( 'Remove trait' ) ).toBeNull();
	} );

	it( 'hides retired traits but keeps them in the written set', async () => {
		render(
			<TraitControl
				documentId={ 5 }
				collections={ [
					{ ...membership( 1, 'Projects' ), active: true },
					{ ...membership( 2, 'People' ), active: true },
					{ ...membership( 3, 'Archived' ), active: false },
				] }
				onChange={ () => {} }
			/>
		);

		expect( screen.queryByText( 'Archived' ) ).toBeNull();
		const removeButtons = screen.getAllByLabelText( 'Remove trait' );
		expect( removeButtons ).toHaveLength( 2 );
		fireEvent.click( removeButtons[ 1 ] );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					data: { collection_ids: [ 1, 3 ] },
				} )
			)
		);
	} );

	it( 'never offers to remove the last live trait', () => {
		render(
			<TraitControl
				documentId={ 5 }
				collections={ [
					{ ...membership( 1, 'Projects' ), active: true },
					{ ...membership( 2, 'Archived' ), active: false },
				] }
				onChange={ () => {} }
			/>
		);

		expect( screen.queryByLabelText( 'Remove trait' ) ).toBeNull();
	} );

	it( 'removes a membership and writes the reduced set', async () => {
		apiFetch.mockResolvedValueOnce( {
			collections: [ { id: 1, active: true } ],
		} );
		const onChange = jest.fn();
		render(
			<TraitControl
				documentId={ 5 }
				collections={ [
					membership( 1, 'Projects' ),
					membership( 2, 'People' ),
				] }
				onChange={ onChange }
			/>
		);

		const removeButtons = screen.getAllByLabelText( 'Remove trait' );
		fireEvent.click( removeButtons[ 1 ] );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/cortext/v1/documents/5/traits',
					method: 'PUT',
					data: { collection_ids: [ 1 ] },
				} )
			)
		);
		expect( mockNotify ).toHaveBeenCalledWith();
		expect( mockNotifyLocatorChanged ).toHaveBeenCalledWith( 5, [ 1 ] );
		await waitFor( () => expect( onChange ).toHaveBeenCalled() );
	} );

	it( 'holds the collection lock from flush through the membership PUT', async () => {
		let finishFlush;
		let finishPut;
		const release = jest.fn();
		const beforeRemoveCollection = jest.fn(
			() =>
				new Promise( ( resolve ) => {
					finishFlush = resolve;
				} )
		);
		apiFetch.mockImplementation(
			() =>
				new Promise( ( resolve ) => {
					finishPut = resolve;
				} )
		);
		render(
			<TraitControl
				beforeRemoveCollection={ beforeRemoveCollection }
				documentId={ 5 }
				collections={ [
					membership( 1, 'Projects' ),
					membership( 2, 'People' ),
				] }
			/>
		);

		fireEvent.click( screen.getAllByLabelText( 'Remove trait' )[ 1 ] );

		expect( beforeRemoveCollection ).toHaveBeenCalledWith( 2 );
		expect( apiFetch ).not.toHaveBeenCalled();

		await act( async () => finishFlush( release ) );
		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( release ).not.toHaveBeenCalled();

		await act( async () =>
			finishPut( { collections: [ { id: 1, active: true } ] } )
		);
		await waitFor( () => expect( release ).toHaveBeenCalledTimes( 1 ) );
	} );

	it( 'releases the collection lock when the membership PUT fails', async () => {
		const release = jest.fn();
		apiFetch.mockRejectedValueOnce( new Error( 'Membership failed.' ) );
		render(
			<TraitControl
				beforeRemoveCollection={ jest
					.fn()
					.mockResolvedValue( release ) }
				documentId={ 5 }
				collections={ [
					membership( 1, 'Projects' ),
					membership( 2, 'People' ),
				] }
			/>
		);

		fireEvent.click( screen.getAllByLabelText( 'Remove trait' )[ 1 ] );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			'Membership failed.'
		);
		expect( release ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps the membership and surfaces an error when pending properties fail to save', async () => {
		const beforeRemoveCollection = jest
			.fn()
			.mockRejectedValue( new Error( 'Could not save Status.' ) );
		render(
			<TraitControl
				beforeRemoveCollection={ beforeRemoveCollection }
				documentId={ 5 }
				collections={ [
					membership( 1, 'Projects' ),
					membership( 2, 'People' ),
				] }
			/>
		);

		fireEvent.click( screen.getAllByLabelText( 'Remove trait' )[ 1 ] );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			'Could not save Status.'
		);
		expect( apiFetch ).not.toHaveBeenCalled();
		expect( screen.getByText( 'People' ) ).toBeInTheDocument();
	} );

	it( 'adds a collection and writes the augmented set', async () => {
		mockAllCollections = [ { id: 3, title: { raw: 'Goals' }, meta: {} } ];
		apiFetch.mockResolvedValueOnce( {
			collections: [
				{ id: 1, active: true },
				{ id: 2, active: false },
				{ id: 3, active: true },
			],
		} );
		const onChange = jest.fn();
		render(
			<TraitControl
				documentId={ 5 }
				collections={ [ membership( 1, 'Projects' ) ] }
				onChange={ onChange }
			/>
		);

		fireEvent.click( screen.getByLabelText( 'Add trait' ) );
		fireEvent.click( screen.getByText( 'Goals' ) );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith(
				expect.objectContaining( {
					path: '/cortext/v1/documents/5/traits',
					method: 'PUT',
					data: { collection_ids: [ 1, 3 ] },
				} )
			)
		);
		expect( mockNotify ).toHaveBeenCalledWith();
		expect( mockNotifyLocatorChanged ).toHaveBeenCalledWith( 5, [ 1, 3 ] );
		// The breadcrumb reads memberships off the core-data record, so the
		// write must invalidate it, not only the local traits hook.
		expect( mockInvalidate ).toHaveBeenCalledWith( 'getEntityRecord', [
			'postType',
			'crtxt_document',
			5,
		] );
	} );

	it( 'does not write when the current memberships have not loaded', () => {
		mockAllCollections = [ { id: 3, title: { raw: 'Goals' }, meta: {} } ];
		render(
			<TraitControl
				documentId={ 5 }
				collections={ [] }
				onChange={ () => {} }
			/>
		);

		fireEvent.click( screen.getByLabelText( 'Add trait' ) );
		fireEvent.click( screen.getByText( 'Goals' ) );

		// An empty set would otherwise replace memberships with just the added
		// id, dropping the row's existing collections.
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'omits collections the row already belongs to from suggestions', () => {
		mockAllCollections = [
			{ id: 1, title: { raw: 'Projects' }, meta: {} },
			{ id: 3, title: { raw: 'Goals' }, meta: {} },
		];
		render(
			<TraitControl
				documentId={ 5 }
				collections={ [ membership( 1, 'Projects' ) ] }
				onChange={ () => {} }
			/>
		);

		fireEvent.click( screen.getByLabelText( 'Add trait' ) );

		expect( screen.getByText( 'Goals' ) ).toBeInTheDocument();
		// 'Projects' appears once as the existing chip, never as a suggestion.
		expect( screen.getAllByText( 'Projects' ) ).toHaveLength( 1 );
	} );

	it( 'searches collections on the server instead of a local first page', async () => {
		const emptyResults = [];
		const searchResults = [
			{ id: 123, title: { raw: 'Remote archive' }, meta: {} },
		];
		mockAllCollections = ( query ) =>
			query.search === 'Remote' ? searchResults : emptyResults;

		render(
			<TraitControl
				documentId={ 5 }
				collections={ [ membership( 1, 'Projects' ) ] }
				onChange={ () => {} }
			/>
		);

		fireEvent.click( screen.getByLabelText( 'Add trait' ) );
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

		render(
			<TraitControl
				documentId={ 5 }
				collections={ [ membership( 1, 'Projects' ) ] }
				onChange={ () => {} }
			/>
		);

		fireEvent.click( screen.getByLabelText( 'Add trait' ) );
		expect( await screen.findByText( 'First page' ) ).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Load more traits' } )
		);

		expect( await screen.findByText( 'Second page' ) ).toBeInTheDocument();
		expect( screen.getByText( 'First page' ) ).toBeInTheDocument();
		expect( mockCollectionQuery.page ).toBe( 2 );
	} );
} );
