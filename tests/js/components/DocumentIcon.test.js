import { readFileSync } from 'fs';
import { join } from 'path';

import { render, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityRecord: jest.fn(),
} ) );

jest.mock( '../../../src/hooks/useDelayedFlag', () => ( {
	__esModule: true,
	default: () => false,
} ) );

jest.mock( '../../../src/components/DocumentIconWp', () => ( {
	__esModule: true,
	default: ( { size } ) => (
		<svg data-testid="wp-glyph" width={ size } height={ size } />
	),
} ) );

import { useEntityRecord } from '@wordpress/core-data';

import DocumentIcon, { parsePageIcon } from '../../../src/components/DocumentIcon';

const DEFAULT_SLOT_SIZE = '16px';
const DEFAULT_GLYPH_SIZE = '22px';

function iconMeta( value ) {
	return JSON.stringify( value );
}

function renderedIcon( container ) {
	return container.querySelector( '.cortext-document-icon' );
}

function expectStableSlot( element, size = DEFAULT_SLOT_SIZE ) {
	expect( element ).toHaveStyle( {
		width: size,
		height: size,
	} );
}

describe( 'PageIcon', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		useEntityRecord.mockReturnValue( { record: null } );
	} );

	it( 'parses supported document icon metadata', () => {
		expect(
			parsePageIcon( iconMeta( { type: 'emoji', value: '\u{1F600}' } ) )
		).toEqual( { type: 'emoji', value: '\u{1F600}' } );
		expect(
			parsePageIcon( iconMeta( { type: 'image', id: 42 } ) )
		).toEqual( { type: 'image', id: 42 } );
		expect(
			parsePageIcon(
				iconMeta( { type: 'wp', name: 'bell', color: 'blue' } )
			)
		).toEqual( { type: 'wp', name: 'bell', color: 'blue' } );
		expect( parsePageIcon( '{' ) ).toBeNull();
		expect(
			parsePageIcon( iconMeta( { type: 'image', id: 0 } ) )
		).toBeNull();
	} );

	it( 'keeps the same slot size for fallback, emoji, wp, and image icons', async () => {
		useEntityRecord.mockReturnValue( {
			record: {
				source_url: 'https://example.test/icon.jpg',
			},
		} );

		const fallback = render( <DocumentIcon /> );
		const fallbackIcon = renderedIcon( fallback.container );
		expect( fallbackIcon ).toHaveClass( 'cortext-document-icon--fallback' );
		expectStableSlot( fallbackIcon );
		expect(
			fallbackIcon.style.getPropertyValue(
				'--cortext-page-icon-glyph-size'
			)
		).toBe( DEFAULT_GLYPH_SIZE );
		expect( fallbackIcon.querySelector( 'svg' ) ).toHaveAttribute(
			'width',
			'22'
		);
		fallback.unmount();

		const emoji = render(
			<DocumentIcon
				icon={ iconMeta( { type: 'emoji', value: '\u{1F600}' } ) }
			/>
		);
		const emojiIcon = renderedIcon( emoji.container );
		expect( emojiIcon ).toHaveClass( 'cortext-document-icon--emoji' );
		expectStableSlot( emojiIcon );
		expect( emojiIcon ).toHaveStyle( { fontSize: '14px' } );
		emoji.unmount();

		const wp = render(
			<DocumentIcon icon={ iconMeta( { type: 'wp', name: 'bell' } ) } />
		);
		const wpIcon = renderedIcon( wp.container );
		expect( wpIcon ).toHaveClass( 'cortext-document-icon--wp' );
		expectStableSlot( wpIcon );
		expect(
			wpIcon.style.getPropertyValue( '--cortext-page-icon-glyph-size' )
		).toBe( DEFAULT_GLYPH_SIZE );
		await waitFor( () =>
			expect(
				wp.container.querySelector( '[data-testid="wp-glyph"]' )
			).toBeInTheDocument()
		);
		wp.unmount();

		const image = render(
			<DocumentIcon icon={ iconMeta( { type: 'image', id: 42 } ) } />
		);
		const imageIcon = renderedIcon( image.container );
		expect( imageIcon ).toHaveClass( 'cortext-document-icon--image-wrap' );
		expectStableSlot( imageIcon );
		expect( image.container.querySelector( 'img' ) ).toHaveAttribute(
			'width',
			'16'
		);
	} );

	it( 'keeps glyph svgs from shrinking in flex containers', () => {
		const stylesheet = readFileSync(
			join( process.cwd(), 'src/components/DocumentIcon.scss' ),
			'utf8'
		);

		expect( stylesheet ).toContain(
			'min-width: var(--cortext-page-icon-glyph-size);'
		);
		expect( stylesheet ).toContain(
			'flex: 0 0 var(--cortext-page-icon-glyph-size);'
		);
		expect( stylesheet ).toContain( 'max-width: none;' );
	} );
} );
