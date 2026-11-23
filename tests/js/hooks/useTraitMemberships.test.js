/**
 * Tests for `src/hooks/useTraitMemberships.js`: every add or remove writes the
 * row's full set of traits through the traits endpoint, and the last live
 * trait the user can see cannot be removed.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockInvalidate = jest.fn();
jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: () => ( { invalidateResolution: mockInvalidate } ),
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	store: {},
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
import useTraitMemberships from '../../../src/hooks/useTraitMemberships';

function membership( id, title, extra = {} ) {
	return { id, title, icon: '', ...extra };
}

function renderTraits( props ) {
	return renderHook( () =>
		useTraitMemberships( { documentId: 5, ...props } )
	);
}

beforeEach( () => {
	apiFetch.mockReset();
	apiFetch.mockResolvedValue( { collections: [] } );
	mockNotify.mockReset();
	mockNotifyLocatorChanged.mockReset();
	mockInvalidate.mockReset();
} );

describe( 'useTraitMemberships', () => {
	it( 'does not offer to remove the last trait', () => {
		const { result } = renderTraits( {
			collections: [ membership( 1, 'Projects' ) ],
		} );

		expect( result.current.canRemove ).toBe( false );
		expect( result.current.canAdd ).toBe( true );
	} );

	it( 'never offers to remove the last live trait', () => {
		const { result } = renderTraits( {
			collections: [
				membership( 1, 'Projects', { active: true } ),
				membership( 2, 'Archived', { active: false } ),
			],
		} );

		expect( result.current.canRemove ).toBe( false );
	} );

	it( 'counts a trait the user cannot read as hidden', () => {
		const { result } = renderTraits( {
			collections: [
				membership( 1, 'Projects', { active: true } ),
				{ id: 2, active: true, readable: false },
			],
		} );

		expect( result.current.canRemove ).toBe( false );
	} );

	it( 'offers neither add nor remove when read-only', () => {
		const { result } = renderTraits( {
			collections: [
				membership( 1, 'Projects' ),
				membership( 2, 'People' ),
			],
			isReadOnly: true,
		} );

		expect( result.current.canAdd ).toBe( false );
		expect( result.current.canRemove ).toBe( false );
	} );

	it( 'removes a trait and keeps hidden ones in the written set', async () => {
		apiFetch.mockResolvedValueOnce( {
			collections: [ { id: 1, active: true } ],
		} );
		const onChange = jest.fn();
		const { result } = renderTraits( {
			collections: [
				membership( 1, 'Projects', { active: true } ),
				membership( 2, 'People', { active: true } ),
				membership( 3, 'Archived', { active: false } ),
			],
			onChange,
		} );

		await act( async () =>
			result.current.removeCollection( membership( 2, 'People' ) )
		);

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/5/traits',
			method: 'PUT',
			data: { collection_ids: [ 1, 3 ] },
		} );
		expect( mockNotify ).toHaveBeenCalledWith();
		expect( mockNotifyLocatorChanged ).toHaveBeenCalledWith( 5, [ 1 ] );
		expect( onChange ).toHaveBeenCalled();
	} );

	it( 'adds a trait and keeps an unreadable one in the written set', async () => {
		apiFetch.mockResolvedValueOnce( {
			collections: [
				{ id: 1, active: true },
				{ id: 2, active: true },
				{ id: 3, active: true },
			],
		} );
		const { result } = renderTraits( {
			collections: [
				membership( 1, 'Projects' ),
				{ id: 2, active: true, readable: false },
			],
		} );

		await act( async () => result.current.addCollection( { id: 3 } ) );

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				data: { collection_ids: [ 1, 2, 3 ] },
			} )
		);
		expect( mockNotifyLocatorChanged ).toHaveBeenCalledWith(
			5,
			[ 1, 2, 3 ]
		);
		// The breadcrumb reads memberships off the core-data record, so the
		// write must invalidate it, not only the local traits hook.
		expect( mockInvalidate ).toHaveBeenCalledWith( 'getEntityRecord', [
			'postType',
			'crtxt_document',
			5,
		] );
	} );

	it( 'does not write when the current memberships have not loaded', async () => {
		const { result } = renderTraits( { collections: [] } );

		await act( async () => result.current.addCollection( { id: 3 } ) );

		// An empty set would otherwise replace memberships with just the added
		// id, dropping the row's existing collections.
		expect( result.current.canAdd ).toBe( false );
		expect( apiFetch ).not.toHaveBeenCalled();
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
		const { result } = renderTraits( {
			beforeRemoveCollection,
			collections: [
				membership( 1, 'Projects' ),
				membership( 2, 'People' ),
			],
		} );

		act( () => {
			result.current.removeCollection( membership( 2, 'People' ) );
		} );

		expect( beforeRemoveCollection ).toHaveBeenCalledWith( 2 );
		expect( apiFetch ).not.toHaveBeenCalled();
		expect( result.current.isSaving ).toBe( true );

		await act( async () => finishFlush( release ) );
		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 1 ) );
		expect( release ).not.toHaveBeenCalled();

		await act( async () =>
			finishPut( { collections: [ { id: 1, active: true } ] } )
		);
		expect( release ).toHaveBeenCalledTimes( 1 );
		expect( result.current.isSaving ).toBe( false );
	} );

	it( 'releases the collection lock when the membership PUT fails', async () => {
		const release = jest.fn();
		apiFetch.mockRejectedValueOnce( new Error( 'Membership failed.' ) );
		const { result } = renderTraits( {
			beforeRemoveCollection: jest.fn().mockResolvedValue( release ),
			collections: [
				membership( 1, 'Projects' ),
				membership( 2, 'People' ),
			],
		} );

		await act( async () =>
			result.current.removeCollection( membership( 2, 'People' ) )
		);

		expect( result.current.error ).toBe( 'Membership failed.' );
		expect( release ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps the membership when pending properties fail to save', async () => {
		const onChange = jest.fn();
		const { result } = renderTraits( {
			beforeRemoveCollection: jest
				.fn()
				.mockRejectedValue( new Error( 'Could not save Status.' ) ),
			collections: [
				membership( 1, 'Projects' ),
				membership( 2, 'People' ),
			],
			onChange,
		} );

		await act( async () =>
			result.current.removeCollection( membership( 2, 'People' ) )
		);

		expect( result.current.error ).toBe( 'Could not save Status.' );
		expect( apiFetch ).not.toHaveBeenCalled();
		expect( onChange ).not.toHaveBeenCalled();
	} );
} );
