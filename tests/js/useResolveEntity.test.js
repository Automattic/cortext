/**
 * Tests for `src/router/useResolveEntity.js`: the id-based URI resolver,
 * `computeUri` slug-plus-id builder, and `parseIdFromUri` extractor.
 * `@wordpress/api-fetch` is mocked so each case controls the REST response.
 */

import { renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import {
	useResolveEntity,
	computeUri,
	parseIdFromUri,
} from '../../src/router/useResolveEntity';

beforeEach( () => {
	apiFetch.mockReset();
} );

describe( 'parseIdFromUri', () => {
	it( 'extracts a bare numeric id', () => {
		expect( parseIdFromUri( '42' ) ).toBe( 42 );
	} );

	it( 'extracts the trailing id from a slug-prefixed uri', () => {
		expect( parseIdFromUri( 'about-us-42' ) ).toBe( 42 );
	} );

	it( 'takes the last numeric chunk when the slug itself ends in digits', () => {
		expect( parseIdFromUri( 'v2-42' ) ).toBe( 42 );
	} );

	it( 'returns null for an empty uri', () => {
		expect( parseIdFromUri( '' ) ).toBeNull();
	} );

	it( 'returns null for a uri without a trailing id', () => {
		expect( parseIdFromUri( 'about-us' ) ).toBeNull();
	} );

	it( 'returns null for a nullish uri', () => {
		expect( parseIdFromUri( undefined ) ).toBeNull();
		expect( parseIdFromUri( null ) ).toBeNull();
	} );
} );

describe( 'useResolveEntity', () => {
	it( 'returns not-resolving immediately when uri is empty', () => {
		const { result } = renderHook( () => useResolveEntity( '' ) );

		expect( result.current ).toEqual( {
			entity: null,
			isResolving: false,
			notFound: false,
		} );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'reports notFound for a non-empty uri with no extractable id', async () => {
		const { result } = renderHook( () => useResolveEntity( 'about-us' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( result.current ).toEqual( {
			entity: null,
			isResolving: false,
			notFound: true,
		} );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'fetches the record by id from a slug-prefixed uri', async () => {
		apiFetch.mockResolvedValueOnce( { id: 42, slug: 'about-us', parent: 0 } );

		const { result } = renderHook( () =>
			useResolveEntity( 'about-us-42' )
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toMatch(
			/\/wp\/v2\/cortext_pages\/42(?:\?|$)/
		);
		expect( result.current ).toEqual( {
			entity: { id: 42, slug: 'about-us', parent: 0 },
			isResolving: false,
			notFound: false,
		} );
	} );

	it( 'fetches the record by id from a bare numeric uri (fresh draft)', async () => {
		apiFetch.mockResolvedValueOnce( { id: 7, slug: '', parent: 0 } );

		const { result } = renderHook( () => useResolveEntity( '7' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toMatch(
			/\/wp\/v2\/cortext_pages\/7(?:\?|$)/
		);
		expect( result.current.entity ).toEqual( {
			id: 7,
			slug: '',
			parent: 0,
		} );
	} );

	it( 'sets notFound when apiFetch rejects', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'boom' ) );

		const { result } = renderHook( () => useResolveEntity( 'broken-99' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( result.current.notFound ).toBe( true );
		expect( result.current.entity ).toBeNull();
	} );

	it( 'does not refetch when the uri rewrites to a canonical form for the same id', async () => {
		apiFetch.mockResolvedValueOnce( { id: 42, slug: '', parent: 0 } );

		const { result, rerender } = renderHook(
			( { uri } ) => useResolveEntity( uri ),
			{ initialProps: { uri: '42' } }
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );

		rerender( { uri: 'about-us-42' } );

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( result.current.isResolving ).toBe( false );
		expect( result.current.entity ).toEqual( {
			id: 42,
			slug: '',
			parent: 0,
		} );
	} );
} );

describe( 'computeUri', () => {
	it( 'joins slug and id with a dash', () => {
		expect( computeUri( { id: 42, slug: 'about-us' } ) ).toBe(
			'about-us-42'
		);
	} );

	it( 'returns a bare id when slug is empty', () => {
		expect( computeUri( { id: 7, slug: '' } ) ).toBe( '7' );
	} );

	it( 'returns a bare id when slug is missing', () => {
		expect( computeUri( { id: 7 } ) ).toBe( '7' );
	} );

	it( 'treats whitespace-only slugs as empty', () => {
		expect( computeUri( { id: 7, slug: '   ' } ) ).toBe( '7' );
	} );
} );
