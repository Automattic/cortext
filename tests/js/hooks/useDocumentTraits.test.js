/**
 * Tests for `src/hooks/useDocumentTraits.js`: loads a document's collection
 * memberships from the traits endpoint and exposes a refresh.
 * `@wordpress/api-fetch` is mocked so each case controls the REST response.
 */

import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import useDocumentTraits from '../../../src/hooks/useDocumentTraits';
import { notifyDocumentLocatorChanged } from '../../../src/hooks/documentLocatorInvalidation';

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'useDocumentTraits', () => {
	it( 'returns empty and does not fetch without a document id', () => {
		const { result } = renderHook( () => useDocumentTraits( null ) );

		expect( result.current.collections ).toEqual( [] );
		expect( result.current.isResolving ).toBe( false );
		expect( result.current.hasResolved ).toBe( true );
		expect( result.current.isUnknown ).toBe( false );
		expect( result.current.isInitialLoad ).toBe( false );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'loads the collections a document belongs to', async () => {
		apiFetch.mockResolvedValue( {
			collections: [ { id: 1, title: 'Projects' } ],
		} );

		const { result } = renderHook( () => useDocumentTraits( 7 ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/7/traits',
		} );
		expect( result.current.collections ).toEqual( [
			{ id: 1, title: 'Projects' },
		] );
		expect( result.current.hasResolved ).toBe( true );
		expect( result.current.isUnknown ).toBe( false );
	} );

	it( 'reloads when a trait write announces this document', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				collections: [ { id: 1, title: 'Projects' } ],
			} )
			.mockResolvedValueOnce( {
				collections: [
					{ id: 1, title: 'Projects' },
					{ id: 2, title: 'Books' },
				],
			} );

		const { result } = renderHook( () => useDocumentTraits( 7 ) );
		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 1 )
		);

		act( () => notifyDocumentLocatorChanged( 8, [ 3 ] ) );
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		act( () => notifyDocumentLocatorChanged( 7, [ 1, 2 ] ) );
		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 2 )
		);
	} );

	it( 'refresh re-pulls the memberships', async () => {
		apiFetch.mockResolvedValueOnce( {
			collections: [ { id: 1, title: 'Projects' } ],
		} );

		const { result } = renderHook( () => useDocumentTraits( 7 ) );
		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 1 )
		);

		apiFetch.mockResolvedValueOnce( {
			collections: [ { id: 1 }, { id: 2 } ],
		} );
		act( () => {
			result.current.refresh();
		} );

		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 2 )
		);
	} );

	it( 'clears actionable memberships while a refresh is pending', async () => {
		let resolveRefresh;
		apiFetch
			.mockResolvedValueOnce( {
				collections: [ { id: 1, title: 'Projects' } ],
			} )
			.mockReturnValueOnce(
				new Promise( ( resolve ) => {
					resolveRefresh = resolve;
				} )
			);

		const { result } = renderHook( () => useDocumentTraits( 7 ) );
		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 1 )
		);

		act( () => result.current.refresh() );
		expect( result.current.isResolving ).toBe( true );
		expect( result.current.hasResolved ).toBe( false );
		expect( result.current.isUnknown ).toBe( true );
		expect( result.current.collections ).toEqual( [] );

		resolveRefresh( { collections: [ { id: 2, title: 'People' } ] } );
		await waitFor( () =>
			expect( result.current.collections ).toEqual( [
				{ id: 2, title: 'People' },
			] )
		);
	} );

	it( 'does not expose the previous row memberships during a row switch', async () => {
		apiFetch.mockResolvedValueOnce( {
			collections: [ { id: 1, title: 'Projects' } ],
		} );
		const { result, rerender } = renderHook(
			( { documentId } ) => useDocumentTraits( documentId ),
			{ initialProps: { documentId: 7 } }
		);
		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 1 )
		);

		apiFetch.mockReturnValueOnce( new Promise( () => {} ) );
		rerender( { documentId: 8 } );

		expect( result.current.collections ).toEqual( [] );
		expect( result.current.isResolving ).toBe( true );
	} );

	it( 'tells the first load of a document from a later refresh', async () => {
		let resolveFirst;
		apiFetch.mockReturnValueOnce(
			new Promise( ( resolve ) => {
				resolveFirst = resolve;
			} )
		);
		const { result, rerender } = renderHook(
			( { documentId } ) => useDocumentTraits( documentId ),
			{ initialProps: { documentId: 7 } }
		);
		expect( result.current.isInitialLoad ).toBe( true );

		resolveFirst( { collections: [ { id: 1, title: 'Projects' } ] } );
		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 1 )
		);
		expect( result.current.isInitialLoad ).toBe( false );

		apiFetch.mockReturnValueOnce( new Promise( () => {} ) );
		act( () => result.current.refresh() );
		expect( result.current.isResolving ).toBe( true );
		expect( result.current.isInitialLoad ).toBe( false );

		apiFetch.mockReturnValueOnce( new Promise( () => {} ) );
		rerender( { documentId: 8 } );
		expect( result.current.isInitialLoad ).toBe( true );
	} );

	it( 'does not treat a retry after a failed first load as a first load', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'nope' ) );
		const { result } = renderHook( () => useDocumentTraits( 7 ) );
		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( result.current.isInitialLoad ).toBe( false );

		apiFetch.mockReturnValueOnce( new Promise( () => {} ) );
		act( () => result.current.refresh() );
		expect( result.current.isResolving ).toBe( true );
		expect( result.current.isInitialLoad ).toBe( false );
	} );

	it( 'exposes an unknown state on a failed request', async () => {
		apiFetch.mockRejectedValue( new Error( 'nope' ) );

		const { result } = renderHook( () => useDocumentTraits( 7 ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( result.current.collections ).toEqual( [] );
		expect( result.current.hasResolved ).toBe( false );
		expect( result.current.isUnknown ).toBe( true );
		expect( result.current.error ).toEqual( new Error( 'nope' ) );
	} );

	it( 'does not turn a failed follow-up refresh into a known empty set', async () => {
		apiFetch.mockResolvedValueOnce( {
			collections: [ { id: 1, title: 'Projects' } ],
		} );
		const { result } = renderHook( () => useDocumentTraits( 7 ) );
		await waitFor( () =>
			expect( result.current.collections ).toHaveLength( 1 )
		);

		apiFetch.mockRejectedValueOnce( new Error( 'refresh failed' ) );
		act( () => result.current.refresh() );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( result.current.collections ).toEqual( [] );
		expect( result.current.hasResolved ).toBe( false );
		expect( result.current.isUnknown ).toBe( true );
		expect( result.current.error ).toEqual( new Error( 'refresh failed' ) );
	} );
} );
