/**
 * Tests for `iconForRecord` and `listIconForRecord` in `src/documents/icons.js`.
 *
 * In the sidebar tree, a collection without a custom icon reads as the
 * collection glyph rendered through DocumentIcon (so its size matches a page); a
 * custom icon wins, pages keep the document glyph, and rows take the post-type
 * glyph.
 * In the compact lists, collection and row glyphs also go through DocumentIcon
 * so they line up in size with page icons.
 *
 * Each helper returns a React element, so the assertions inspect its type and
 * props directly rather than rendering the icon SVGs.
 */
import { Icon, customPostType } from '@wordpress/icons';

import { iconForRecord, listIconForRecord } from '../../../src/documents/icons';
import DocumentIcon from '../../../src/components/DocumentIcon';

it( 'renders a collection without a custom icon as the collection glyph through DocumentIcon', () => {
	const element = iconForRecord( { cortext_defines_trait: true } );
	expect( element.type ).toBe( DocumentIcon );
	expect( JSON.parse( element.props.icon ) ).toEqual( {
		type: 'wp',
		name: 'collection',
	} );
} );

it( 'lets a custom icon win for a collection', () => {
	const meta = JSON.stringify( { type: 'emoji', value: '📚' } );
	const element = iconForRecord( {
		cortext_defines_trait: true,
		meta: { cortext_document_icon: meta },
	} );
	expect( element.type ).toBe( DocumentIcon );
	expect( element.props.icon ).toBe( meta );
} );

it( 'renders a page through DocumentIcon', () => {
	const element = iconForRecord( {} );
	expect( element.type ).toBe( DocumentIcon );
	expect( element.props.icon ).toBe( '' );
} );

it( 'gives a row the static post-type glyph', () => {
	const element = iconForRecord( { crtxt_trait: [ 12 ] } );
	expect( element.type ).toBe( Icon );
	expect( element.props.icon ).toBe( customPostType );
} );

describe( 'listIconForRecord', () => {
	it( 'renders a collection as the collection glyph through DocumentIcon', () => {
		const element = listIconForRecord( { cortext_defines_trait: true } );
		expect( element.type ).toBe( DocumentIcon );
		expect( JSON.parse( element.props.icon ) ).toEqual( {
			type: 'wp',
			name: 'collection',
		} );
	} );

	it( 'renders a row as the list glyph through DocumentIcon', () => {
		const element = listIconForRecord( { crtxt_trait: [ 12 ] } );
		expect( element.type ).toBe( DocumentIcon );
		expect( JSON.parse( element.props.icon ) ).toEqual( {
			type: 'wp',
			name: 'listItem',
		} );
	} );

	it( 'lets a custom icon win', () => {
		const meta = JSON.stringify( { type: 'emoji', value: '📚' } );
		const element = listIconForRecord( {
			cortext_defines_trait: true,
			meta: { cortext_document_icon: meta },
		} );
		expect( element.type ).toBe( DocumentIcon );
		expect( element.props.icon ).toBe( meta );
	} );

	it( 'renders a page through DocumentIcon', () => {
		const element = listIconForRecord( {} );
		expect( element.type ).toBe( DocumentIcon );
		expect( element.props.icon ).toBe( '' );
	} );
} );
