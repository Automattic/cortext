import { act, renderHook } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecords: jest.fn(),
} ) );

import { useEntityRecords } from '@wordpress/core-data';
import { collectionSearchQuery } from '../../../src/collections';
import useCollectionSearch from '../../../src/hooks/useCollectionSearch';

beforeEach( () => {
	jest.useFakeTimers();
	jest.clearAllMocks();
} );

afterEach( () => {
	jest.useRealTimers();
} );

describe( 'collectionSearchQuery', () => {
	// `meta` is what makes the shared collections list slow to refetch.
	it( 'leaves meta out of the picker query', () => {
		expect(
			collectionSearchQuery( '' )._fields.split( ',' )
		).not.toContain( 'meta' );
	} );

	// Every collection's content holds block markup, so a content match would
	// return them all for words like "view".
	it( 'matches a search against titles only', () => {
		expect( collectionSearchQuery( 'view' ).search_columns ).toEqual( [
			'post_title',
		] );
	} );
} );

describe( 'useCollectionSearch', () => {
	it( 'debounces the search before querying', () => {
		useEntityRecords.mockReturnValue( {
			records: [],
			isResolving: false,
			hasResolved: true,
		} );
		const { result, rerender } = renderHook(
			( { search } ) => useCollectionSearch( search ),
			{ initialProps: { search: '' } }
		);

		rerender( { search: ' Invoices ' } );
		expect( useEntityRecords ).toHaveBeenLastCalledWith(
			'postType',
			'crtxt_document',
			collectionSearchQuery( '' )
		);
		expect( result.current.isResolving ).toBe( true );
		expect( result.current.hasResolved ).toBe( false );

		act( () => {
			jest.advanceTimersByTime( 200 );
		} );
		expect( useEntityRecords ).toHaveBeenLastCalledWith(
			'postType',
			'crtxt_document',
			collectionSearchQuery( 'Invoices' )
		);
		expect( result.current.isResolving ).toBe( false );
	} );

	it( 'keeps the previous results while the next query loads', () => {
		const first = [ { id: 1, title: { raw: 'Invoices' } } ];
		useEntityRecords.mockReturnValue( {
			records: first,
			isResolving: false,
			hasResolved: true,
		} );
		const { result, rerender } = renderHook(
			( { search } ) => useCollectionSearch( search ),
			{ initialProps: { search: '' } }
		);

		useEntityRecords.mockReturnValue( {
			records: null,
			isResolving: true,
			hasResolved: false,
		} );
		rerender( { search: 'Inv' } );

		expect( result.current.records ).toBe( first );
	} );
} );
