/**
 * Covers `src/components/collectionsBlockCategory.js`. The module must run
 * before Cortext block files import, because Gutenberg drops unknown
 * categories during `registerBlockType`.
 */

jest.mock( '@wordpress/blocks', () => ( {
	getCategories: jest.fn( () => [] ),
	setCategories: jest.fn(),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( str ) => str,
} ) );

import { getCategories, setCategories } from '@wordpress/blocks';

import {
	COLLECTIONS_BLOCK_CATEGORY,
	ensureCollectionsCategory,
} from '../../src/components/collectionsBlockCategory';

beforeEach( () => {
	getCategories.mockClear();
	setCategories.mockClear();
	getCategories.mockReturnValue( [] );
} );

describe( 'COLLECTIONS_BLOCK_CATEGORY', () => {
	it( 'uses the slug referenced by Cortext block.json files', () => {
		expect( COLLECTIONS_BLOCK_CATEGORY.slug ).toBe( 'collections' );
	} );

	it( 'carries a translated title', () => {
		expect( COLLECTIONS_BLOCK_CATEGORY.title ).toBe( 'Collections' );
	} );
} );

describe( 'ensureCollectionsCategory', () => {
	it( 'adds the Collections category ahead of existing categories', () => {
		getCategories.mockReturnValue( [
			{ slug: 'text', title: 'Text' },
			{ slug: 'media', title: 'Media' },
		] );

		ensureCollectionsCategory();

		expect( setCategories ).toHaveBeenCalledTimes( 1 );
		expect( setCategories ).toHaveBeenCalledWith( [
			COLLECTIONS_BLOCK_CATEGORY,
			{ slug: 'text', title: 'Text' },
			{ slug: 'media', title: 'Media' },
		] );
	} );

	it( 'does not add the Collections category twice', () => {
		getCategories.mockReturnValueOnce( [
			{ slug: 'text', title: 'Text' },
		] );
		ensureCollectionsCategory();

		getCategories.mockReturnValueOnce( [
			COLLECTIONS_BLOCK_CATEGORY,
			{ slug: 'text', title: 'Text' },
		] );
		ensureCollectionsCategory();

		expect( setCategories ).toHaveBeenCalledTimes( 1 );
	} );
} );
