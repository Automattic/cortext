/**
 * Tests for `src/router/useResolveEntity.js`: the document URI resolver,
 * URI builders, and `parseIdFromUri` extractor. `@wordpress/api-fetch` is
 * mocked so each case controls the REST responses (locator + record fetch).
 */

import { renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import {
	computeCollectionUri,
	computeDocumentUri,
	parseIdFromUri,
	useResolveDocument,
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

describe( 'useResolveDocument', () => {
	it( 'returns not-resolving immediately when uri is empty', () => {
		const { result } = renderHook( () => useResolveDocument( '' ) );

		expect( result.current ).toEqual( {
			entity: null,
			isResolving: false,
			notFound: false,
			id: null,
		} );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'reports notFound for a non-empty uri with no extractable id', async () => {
		const { result } = renderHook( () => useResolveDocument( 'about-us' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( result.current ).toEqual( {
			entity: null,
			isResolving: false,
			notFound: true,
			id: null,
		} );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'discovers rest_base via locator and fetches the record', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				id: 42,
				type: 'crtxt_page',
				rest_base: 'crtxt_pages',
				slug: 'about-us',
			} )
			.mockResolvedValueOnce( {
				id: 42,
				slug: 'about-us',
				parent: 0,
				type: 'crtxt_page',
			} );

		const { result } = renderHook( () =>
			useResolveDocument( 'about-us-42' )
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toBe(
			'/cortext/v1/documents/42'
		);
		// Pages register rest_base `crtxt_pages`, so fetching with the
		// post_type `crtxt_page` would 404. The resolver must use rest_base.
		expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toMatch(
			/\/wp\/v2\/crtxt_pages\/42(?:\?|$)/
		);
		expect( result.current ).toEqual( {
			entity: {
				id: 42,
				slug: 'about-us',
				parent: 0,
				type: 'crtxt_page',
			},
			isResolving: false,
			notFound: false,
			id: 42,
		} );
	} );

	it( 'resolves a row by discovering its dynamic CPT', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				id: 96,
				type: 'crtxt_projects',
				rest_base: 'crtxt_projects',
				slug: 'demo-workspace',
			} )
			.mockResolvedValueOnce( {
				id: 96,
				slug: 'demo-workspace',
				parent: 0,
				type: 'crtxt_projects',
			} );

		const { result } = renderHook( () =>
			useResolveDocument( 'demo-workspace-96' )
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toMatch(
			/\/wp\/v2\/crtxt_projects\/96(?:\?|$)/
		);
		expect( result.current.entity?.type ).toBe( 'crtxt_projects' );
	} );

	it( 'sets notFound when the locator rejects (id unknown or not a document)', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'boom' ) );

		const { result } = renderHook( () =>
			useResolveDocument( 'broken-99' )
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( result.current.notFound ).toBe( true );
		expect( result.current.entity ).toBeNull();
		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'sets notFound when the record fetch rejects after a successful locate', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				id: 42,
				type: 'crtxt_page',
				rest_base: 'crtxt_pages',
				slug: 'about-us',
			} )
			.mockRejectedValueOnce( new Error( 'no record' ) );

		const { result } = renderHook( () =>
			useResolveDocument( 'about-us-42' )
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( result.current.notFound ).toBe( true );
		expect( result.current.entity ).toBeNull();
	} );

	it( 'does not refetch when the uri rewrites to a canonical form for the same id', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				id: 42,
				type: 'crtxt_page',
				rest_base: 'crtxt_pages',
				slug: '',
			} )
			.mockResolvedValueOnce( {
				id: 42,
				slug: '',
				parent: 0,
				type: 'crtxt_page',
			} );

		const { result, rerender } = renderHook(
			( { uri } ) => useResolveDocument( uri ),
			{ initialProps: { uri: '42' } }
		);

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );

		rerender( { uri: 'about-us-42' } );

		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( result.current.isResolving ).toBe( false );
		expect( result.current.entity?.id ).toBe( 42 );
	} );
} );

describe( 'computeDocumentUri', () => {
	it( 'joins slug and id with a dash (no prefix)', () => {
		expect( computeDocumentUri( { id: 42, slug: 'about-us' } ) ).toBe(
			'about-us-42'
		);
	} );

	it( 'returns the bare id when slug is empty', () => {
		expect( computeDocumentUri( { id: 7, slug: '' } ) ).toBe( '7' );
	} );

	it( 'returns the bare id when slug is missing', () => {
		expect( computeDocumentUri( { id: 7 } ) ).toBe( '7' );
	} );

	it( 'treats whitespace-only slugs as empty', () => {
		expect( computeDocumentUri( { id: 7, slug: '   ' } ) ).toBe( '7' );
	} );
} );

describe( 'computeCollectionUri', () => {
	it( 'prefixes with `collection/` and includes the slug', () => {
		expect( computeCollectionUri( { id: 3, slug: 'books' } ) ).toBe(
			'collection/books-3'
		);
	} );

	it( 'falls back to bare id when slug is missing', () => {
		expect( computeCollectionUri( { id: 3 } ) ).toBe( 'collection/3' );
	} );
} );
