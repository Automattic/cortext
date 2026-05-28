/**
 * Covers the block allowlist, `getEditorSettings`, and the Cortext category
 * re-export from `src/components/initEditor.js`.
 */

jest.mock( '@wordpress/block-library', () => ( {
	registerCoreBlocks: jest.fn(),
} ) );

jest.mock( '@wordpress/blocks', () => ( {
	getCategories: jest.fn( () => [] ),
	setCategories: jest.fn(),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( str ) => str,
} ) );

// Mock the block barrel; importing the real one pulls in every block edit/save
// component.
jest.mock( '../../src/blocks', () => ( {} ) );

import {
	ALLOWED_BLOCK_TYPES,
	CORTEXT_BLOCK_CATEGORY,
	getEditorSettings,
} from '../../src/components/initEditor';

beforeEach( () => {
	delete window.cortextEditorSettings;
} );

describe( 'ALLOWED_BLOCK_TYPES', () => {
	it( 'covers the basic text and structure blocks', () => {
		expect( ALLOWED_BLOCK_TYPES ).toEqual(
			expect.arrayContaining( [
				'core/paragraph',
				'core/heading',
				'core/list',
				'core/list-item',
				'core/quote',
				'core/code',
				'core/preformatted',
			] )
		);
	} );

	it( 'covers media and layout blocks', () => {
		expect( ALLOWED_BLOCK_TYPES ).toEqual(
			expect.arrayContaining( [
				'core/image',
				'core/gallery',
				'core/video',
				'core/cover',
				'core/columns',
				'core/column',
				'core/group',
				'core/separator',
			] )
		);
	} );

	it( 'allows core/post-title so EnsureHeaderBlocks can insert it', () => {
		// EditorBody's EnsureHeaderBlocks dispatches insertBlocks for
		// core/post-title. Without this entry, canInsertBlockType rejects the
		// locked header.
		expect( ALLOWED_BLOCK_TYPES ).toContain( 'core/post-title' );
	} );

	it( 'allows post-context blocks that work from editor context', () => {
		expect( ALLOWED_BLOCK_TYPES ).toEqual(
			expect.arrayContaining( [
				'core/post-date',
				'core/post-time-to-read',
			] )
		);
	} );

	it( 'excludes post-context blocks that need post-type supports we do not declare', () => {
		// core/post-author and core/post-author-name require the post type
		// to support 'author'. core/post-excerpt requires 'excerpt'.
		// Cortext's crtxt_page and crtxt_collection don't declare either.
		const denied = [
			'core/post-author',
			'core/post-author-name',
			'core/post-excerpt',
		];
		denied.forEach( ( name ) =>
			expect( ALLOWED_BLOCK_TYPES ).not.toContain( name )
		);
	} );

	it( 'allows social-link blocks', () => {
		expect( ALLOWED_BLOCK_TYPES ).toEqual(
			expect.arrayContaining( [
				'core/social-link',
				'core/social-links',
			] )
		);
	} );

	it( 'allows the Cortext-native blocks', () => {
		expect( ALLOWED_BLOCK_TYPES ).toEqual(
			expect.arrayContaining( [
				'cortext/data-view',
				'cortext/document-icon',
				'cortext/document-cover',
				'cortext/document-properties',
			] )
		);
	} );

	it( 'allows reusable and pattern blocks', () => {
		expect( ALLOWED_BLOCK_TYPES ).toEqual(
			expect.arrayContaining( [ 'core/pattern', 'core/block' ] )
		);
	} );

	it( 'allows core/embed', () => {
		expect( ALLOWED_BLOCK_TYPES ).toContain( 'core/embed' );
	} );

	it( 'excludes external-content blocks called out in the issue', () => {
		const denied = [
			'core/latest-posts',
			'core/latest-comments',
			'core/rss',
			'core/archives',
			'core/calendar',
			'core/categories',
			'core/tag-cloud',
			'core/page-list',
		];
		denied.forEach( ( name ) =>
			expect( ALLOWED_BLOCK_TYPES ).not.toContain( name )
		);
	} );

	it( 'excludes site-chrome and template blocks', () => {
		const denied = [
			'core/site-logo',
			'core/site-title',
			'core/navigation',
			'core/template-part',
			'core/login-logout',
		];
		denied.forEach( ( name ) =>
			expect( ALLOWED_BLOCK_TYPES ).not.toContain( name )
		);
	} );

	it( 'excludes the Query Loop family and feed-only post-context blocks', () => {
		const denied = [
			'core/query',
			'core/post-template',
			'core/post-content',
			'core/post-featured-image',
			'core/post-navigation-link',
			'core/post-terms',
		];
		denied.forEach( ( name ) =>
			expect( ALLOWED_BLOCK_TYPES ).not.toContain( name )
		);
	} );

	it( 'has no duplicate entries', () => {
		expect( new Set( ALLOWED_BLOCK_TYPES ).size ).toBe(
			ALLOWED_BLOCK_TYPES.length
		);
	} );
} );

describe( 'getEditorSettings', () => {
	it( 'injects allowedBlockTypes into the base settings', () => {
		window.cortextEditorSettings = {
			styles: [ { css: 'body{}' } ],
			__experimentalFeatures: { typography: { dropCap: true } },
		};

		const settings = getEditorSettings();

		expect( settings.styles ).toEqual( [ { css: 'body{}' } ] );
		expect( settings.__experimentalFeatures ).toEqual( {
			typography: { dropCap: true },
		} );
		expect( settings.allowedBlockTypes ).toBe( ALLOWED_BLOCK_TYPES );
	} );

	it( 'works when window.cortextEditorSettings is missing', () => {
		const settings = getEditorSettings();

		expect( settings.allowedBlockTypes ).toBe( ALLOWED_BLOCK_TYPES );
	} );

	it( 'overrides any allowedBlockTypes already on the base settings', () => {
		window.cortextEditorSettings = {
			allowedBlockTypes: [ 'core/everything' ],
		};

		const settings = getEditorSettings();

		expect( settings.allowedBlockTypes ).toBe( ALLOWED_BLOCK_TYPES );
	} );
} );

describe( 're-exported CORTEXT_BLOCK_CATEGORY', () => {
	it( 'matches the constant from cortextBlockCategory', () => {
		expect( CORTEXT_BLOCK_CATEGORY.slug ).toBe( 'cortext' );
	} );
} );
