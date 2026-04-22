/**
 * Tests for `src/router/useResolveEntity.js`: the segment-walking URI → page
 * resolver hook and the `computeUri` slug-chain helper. `@wordpress/api-fetch`
 * is mocked so each case controls the REST responses driving the walk.
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
} from '../../src/router/useResolveEntity';

beforeEach( () => {
	apiFetch.mockReset();
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

	it( 'resolves a single-segment uri with parent=0', async () => {
		apiFetch.mockResolvedValueOnce( [ { id: 7, slug: 'foo', parent: 0 } ] );

		const { result } = renderHook( () => useResolveEntity( 'foo' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( apiFetch ).toHaveBeenCalledTimes( 1 );
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toMatch(
			/slug=foo(?:&|$)/
		);
		expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toMatch(
			/parent=0(?:&|$)/
		);
		expect( result.current ).toEqual( {
			entity: { id: 7, slug: 'foo', parent: 0 },
			isResolving: false,
			notFound: false,
		} );
	} );

	it( 'walks a two-segment uri, using parent id from the first hop', async () => {
		apiFetch
			.mockResolvedValueOnce( [ { id: 7, slug: 'foo', parent: 0 } ] )
			.mockResolvedValueOnce( [ { id: 8, slug: 'bar', parent: 7 } ] );

		const { result } = renderHook( () => useResolveEntity( 'foo/bar' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toMatch(
			/slug=bar(?:&|$)/
		);
		expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toMatch(
			/parent=7(?:&|$)/
		);
		expect( result.current.entity ).toEqual( {
			id: 8,
			slug: 'bar',
			parent: 7,
		} );
	} );

	it( 'sets notFound when a segment has no results', async () => {
		apiFetch.mockResolvedValueOnce( [] );

		const { result } = renderHook( () => useResolveEntity( 'ghost' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( result.current ).toEqual( {
			entity: null,
			isResolving: false,
			notFound: true,
		} );
	} );

	it( 'sets notFound when apiFetch rejects', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'boom' ) );

		const { result } = renderHook( () => useResolveEntity( 'broken' ) );

		await waitFor( () =>
			expect( result.current.isResolving ).toBe( false )
		);

		expect( result.current.notFound ).toBe( true );
		expect( result.current.entity ).toBeNull();
	} );
} );

describe( 'computeUri', () => {
	it( 'joins slugs walking the parent chain', () => {
		const pages = [
			{ id: 1, slug: 'top', parent: 0 },
			{ id: 2, slug: 'mid', parent: 1 },
			{ id: 3, slug: 'leaf', parent: 2 },
		];
		expect( computeUri( pages[ 2 ], pages ) ).toBe( 'top/mid/leaf' );
	} );

	it( 'stops cleanly when a parent id is missing from allPages', () => {
		const pages = [ { id: 3, slug: 'leaf', parent: 99 } ];
		expect( computeUri( pages[ 0 ], pages ) ).toBe( 'leaf' );
	} );
} );
