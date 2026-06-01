jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

// The module registers its categories with the block-editor store at import
// time. Stub the store and dispatch so that side effect is a no-op here.
jest.mock( '@wordpress/block-editor', () => ( {
	store: 'core/block-editor',
} ) );
jest.mock( '@wordpress/data', () => ( {
	dispatch: () => ( { registerInserterMediaCategory: jest.fn() } ),
} ) );

import apiFetch from '@wordpress/api-fetch';
import { CORTEXT_INSERTER_MEDIA_CATEGORIES } from '../../src/components/initInserterMediaCategories';

function lastRequestPath() {
	return decodeURIComponent( apiFetch.mock.calls.at( -1 )[ 0 ].path );
}

function categoryByName( name ) {
	return CORTEXT_INSERTER_MEDIA_CATEGORIES.find( ( c ) => c.name === name );
}

beforeEach( () => {
	jest.clearAllMocks();
	apiFetch.mockResolvedValue( [] );
} );

describe( 'CORTEXT_INSERTER_MEDIA_CATEGORIES', () => {
	it.each( [
		[ 'images', 'image' ],
		[ 'videos', 'video' ],
		[ 'audio', 'audio' ],
	] )(
		'scopes the %s category fetch to Cortext documents',
		async ( name, mediaType ) => {
			await categoryByName( name ).fetch();

			const path = lastRequestPath();
			expect( path ).toContain( '/wp/v2/media' );
			expect( path ).toContain( `media_type=${ mediaType }` );
			expect( path ).toContain( 'cortext_origin=1' );
		}
	);

	it( 'preserves the inserter query (search, pagination) alongside the scope', async () => {
		await categoryByName( 'images' ).fetch( {
			search: 'cat',
			page: 2,
			per_page: 20,
		} );

		const path = lastRequestPath();
		expect( path ).toContain( 'search=cat' );
		expect( path ).toContain( 'page=2' );
		expect( path ).toContain( 'per_page=20' );
		expect( path ).toContain( 'cortext_origin=1' );
	} );

	it( 'maps REST media fields to the shape the inserter expects', async () => {
		apiFetch.mockResolvedValue( [
			{
				id: 7,
				source_url: 'https://example.test/full.jpg',
				alt_text: 'A cat',
				caption: { raw: 'A caption' },
				media_details: {
					sizes: {
						medium: {
							source_url: 'https://example.test/medium.jpg',
						},
					},
				},
			},
		] );

		const items = await categoryByName( 'images' ).fetch();

		expect( items[ 0 ] ).toMatchObject( {
			id: 7,
			previewUrl: 'https://example.test/medium.jpg',
			url: 'https://example.test/full.jpg',
			alt: 'A cat',
			caption: 'A caption',
		} );
	} );

	it( 'falls back to the full source_url when no medium size exists', async () => {
		apiFetch.mockResolvedValue( [
			{
				id: 8,
				source_url: 'https://example.test/only.png',
				media_details: { sizes: {} },
			},
		] );

		const items = await categoryByName( 'images' ).fetch();

		expect( items[ 0 ].previewUrl ).toBe( 'https://example.test/only.png' );
	} );
} );
