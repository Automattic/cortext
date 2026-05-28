/**
 * Covers `src/components/cortextBlockCategory.js`. The module must run before
 * Cortext block files import, because Gutenberg drops unknown categories during
 * `registerBlockType`.
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
	CORTEXT_BLOCK_CATEGORY,
	ensureCortextCategory,
} from '../../src/components/cortextBlockCategory';

beforeEach( () => {
	getCategories.mockClear();
	setCategories.mockClear();
	getCategories.mockReturnValue( [] );
} );

describe( 'CORTEXT_BLOCK_CATEGORY', () => {
	it( 'uses the slug referenced by Cortext block.json files', () => {
		expect( CORTEXT_BLOCK_CATEGORY.slug ).toBe( 'cortext' );
	} );

	it( 'carries a translated title', () => {
		expect( CORTEXT_BLOCK_CATEGORY.title ).toBe( 'Cortext' );
	} );
} );

describe( 'ensureCortextCategory', () => {
	it( 'adds the Cortext category ahead of existing categories', () => {
		getCategories.mockReturnValue( [
			{ slug: 'text', title: 'Text' },
			{ slug: 'media', title: 'Media' },
		] );

		ensureCortextCategory();

		expect( setCategories ).toHaveBeenCalledTimes( 1 );
		expect( setCategories ).toHaveBeenCalledWith( [
			CORTEXT_BLOCK_CATEGORY,
			{ slug: 'text', title: 'Text' },
			{ slug: 'media', title: 'Media' },
		] );
	} );

	it( 'does not add the Cortext category twice', () => {
		getCategories.mockReturnValueOnce( [
			{ slug: 'text', title: 'Text' },
		] );
		ensureCortextCategory();

		getCategories.mockReturnValueOnce( [
			CORTEXT_BLOCK_CATEGORY,
			{ slug: 'text', title: 'Text' },
		] );
		ensureCortextCategory();

		expect( setCategories ).toHaveBeenCalledTimes( 1 );
	} );
} );
