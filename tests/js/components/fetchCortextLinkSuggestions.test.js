jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import apiFetch from '@wordpress/api-fetch';
import { fetchCortextLinkSuggestions } from '../../../src/components/fetchCortextLinkSuggestions';

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( [] );
} );

it( 'queries the Cortext document REST base, not wp/v2/search', async () => {
	await fetchCortextLinkSuggestions( 'docs' );

	const { path } = apiFetch.mock.calls[ 0 ][ 0 ];
	expect( path ).toContain( '/wp/v2/crtxt_documents' );
	expect( path ).not.toContain( '/wp/v2/search' );
	expect( path ).toContain( 'search=docs' );
	expect( path ).toContain( 'context=edit' );
	expect( path ).toContain( 'slug' );
	expect( path ).toContain( 'meta' );
} );

it( 'includes draft, private and publish statuses (and so excludes trash)', async () => {
	await fetchCortextLinkSuggestions( 'x' );

	const path = decodeURIComponent( apiFetch.mock.calls[ 0 ][ 0 ].path );
	expect( path ).toContain( 'status[0]=draft' );
	expect( path ).toContain( 'status[1]=private' );
	expect( path ).toContain( 'status[2]=publish' );
	expect( path ).not.toContain( 'trash' );
} );

it( 'defaults initial suggestions to 3 results and searches to 20', async () => {
	await fetchCortextLinkSuggestions( 'x', { isInitialSuggestions: true } );
	expect( apiFetch.mock.calls[ 0 ][ 0 ].path ).toContain( 'per_page=3' );

	await fetchCortextLinkSuggestions( 'x' );
	expect( apiFetch.mock.calls[ 1 ][ 0 ].path ).toContain( 'per_page=20' );
} );

it( 'honours explicit page and perPage', async () => {
	await fetchCortextLinkSuggestions( 'x', { page: 4, perPage: 7 } );

	const { path } = apiFetch.mock.calls[ 0 ][ 0 ];
	expect( path ).toContain( 'page=4' );
	expect( path ).toContain( 'per_page=7' );
} );

it( 'maps documents to permalink suggestions using the raw title', async () => {
	apiFetch.mockResolvedValueOnce( [
		{
			id: 12,
			link: 'https://example.test/cortext/about/',
			slug: 'about',
			title: { raw: 'About & Co' },
			meta: {
				cortext_document_icon: '{"type":"emoji","value":"A"}',
			},
		},
	] );

	const suggestions = await fetchCortextLinkSuggestions( 'about' );

	expect( suggestions ).toEqual( [
		{
			id: 12,
			url: 'https://example.test/cortext/about/',
			path: 'about-12',
			icon: '{"type":"emoji","value":"A"}',
			cortext_defines_trait: undefined,
			crtxt_trait: undefined,
			title: 'About & Co',
			type: 'crtxt_document',
			kind: 'post-type',
		},
	] );
} );

it( 'falls back to a placeholder title and drops records without an id or url', async () => {
	apiFetch.mockResolvedValueOnce( [
		{
			id: 1,
			link: 'https://example.test/?p=1',
			slug: '',
			title: { raw: '' },
		},
		{ id: 0, link: 'https://example.test/x', title: { raw: 'no id' } },
		{ id: 2, link: '', title: { raw: 'no url' } },
	] );

	const suggestions = await fetchCortextLinkSuggestions( 'x' );

	expect( suggestions ).toEqual( [
		{
			id: 1,
			url: 'https://example.test/?p=1',
			path: '1',
			icon: '',
			cortext_defines_trait: undefined,
			crtxt_trait: undefined,
			title: '(no title)',
			type: 'crtxt_document',
			kind: 'post-type',
		},
	] );
} );

it( 'returns an empty array when the request fails', async () => {
	apiFetch.mockRejectedValueOnce( new Error( 'boom' ) );

	await expect( fetchCortextLinkSuggestions( 'x' ) ).resolves.toEqual( [] );
} );
