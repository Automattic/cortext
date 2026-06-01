/**
 * Tests for `iconForRecord` in `src/documents/icons.js`.
 *
 * A collection without a custom icon must read as a collection in the sidebar
 * tree (the table glyph), rendered through DocumentIcon so its size matches a
 * page, while a custom icon still wins, pages keep the document glyph, and rows
 * take the post-type glyph.
 *
 * The helper returns a React element, so the assertions inspect its type and
 * props directly rather than rendering the icon SVGs.
 */
import { Icon, customPostType } from '@wordpress/icons';

import { iconForRecord } from '../../../src/documents/icons';
import DocumentIcon from '../../../src/components/DocumentIcon';

it( 'renders a collection without a custom icon as the table glyph through DocumentIcon', () => {
	const element = iconForRecord( { cortext_defines_trait: true } );
	expect( element.type ).toBe( DocumentIcon );
	expect( JSON.parse( element.props.icon ) ).toEqual( {
		type: 'wp',
		name: 'table',
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
