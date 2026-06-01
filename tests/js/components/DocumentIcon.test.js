import { readFileSync } from 'fs';
import { join } from 'path';

import { fireEvent, render, screen, waitFor } from '@testing-library/react';

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

import DocumentIcon, {
	parseDocumentIcon,
} from '../../../src/components/DocumentIcon';

const BOOK_EMOJI = '\uD83D\uDCD8';
const DEFAULT_SLOT_SIZE = '16px';
const DEFAULT_GLYPH_SIZE = '22px';
const DOCUMENT_GLYPH_SIZE_VAR = '--cortext-document-icon-glyph-size';

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

describe( 'parseDocumentIcon', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		useEntityRecord.mockReturnValue( { record: null } );
	} );

	it( 'parses supported document icon metadata', () => {
		expect(
			parseDocumentIcon(
				iconMeta( { type: 'emoji', value: BOOK_EMOJI } )
			)
		).toEqual( { type: 'emoji', value: BOOK_EMOJI } );
		expect(
			parseDocumentIcon( iconMeta( { type: 'image', id: 42 } ) )
		).toEqual( { type: 'image', id: 42 } );
		expect(
			parseDocumentIcon(
				iconMeta( { type: 'wp', name: 'bell', color: 'blue' } )
			)
		).toEqual( { type: 'wp', name: 'bell', color: 'blue' } );
	} );

	it( 'rejects empty, malformed, and invalid meta', () => {
		expect( parseDocumentIcon( '' ) ).toBeNull();
		expect( parseDocumentIcon( '{' ) ).toBeNull();
		expect(
			parseDocumentIcon( iconMeta( { type: 'emoji', value: '' } ) )
		).toBeNull();
		expect(
			parseDocumentIcon( iconMeta( { type: 'image', id: 0 } ) )
		).toBeNull();
		expect(
			parseDocumentIcon( iconMeta( { type: 'wp', name: '' } ) )
		).toBeNull();
	} );
} );

describe( 'DocumentIcon', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		useEntityRecord.mockReturnValue( { record: null } );
	} );

	it( 'uses the same outer slot for fallback, emoji, wp, and image icons', async () => {
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
			fallbackIcon.style.getPropertyValue( DOCUMENT_GLYPH_SIZE_VAR )
		).toBe( DEFAULT_GLYPH_SIZE );
		expect( fallbackIcon.querySelector( 'svg' ) ).toHaveAttribute(
			'width',
			'22'
		);
		fallback.unmount();

		const emoji = render(
			<DocumentIcon
				icon={ iconMeta( { type: 'emoji', value: BOOK_EMOJI } ) }
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
		expect( wpIcon.style.getPropertyValue( DOCUMENT_GLYPH_SIZE_VAR ) ).toBe(
			DEFAULT_GLYPH_SIZE
		);
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

	it( 'keeps the image wrapper and loading behavior intact', () => {
		useEntityRecord.mockReturnValue( {
			record: {
				media_details: {
					sizes: {
						thumbnail: {
							source_url: 'https://example.test/thumb.jpg',
						},
					},
				},
				source_url: 'https://example.test/full.jpg',
			},
		} );

		const { container } = render(
			<DocumentIcon
				icon={ iconMeta( { type: 'image', id: 42 } ) }
				size={ 28 }
				alt="Cover"
				className="extra-class"
			/>
		);
		const wrapper = container.firstElementChild;
		const image = screen.getByRole( 'img', { name: 'Cover' } );

		expect( useEntityRecord ).toHaveBeenCalledWith( 'root', 'media', 42 );
		expect( wrapper ).toHaveClass(
			'cortext-document-icon',
			'cortext-document-icon--image-wrap',
			'extra-class'
		);
		expectStableSlot( wrapper, '28px' );
		expect(
			wrapper.querySelector( '.cortext-document-icon--image-loading' )
		).toBeInTheDocument();
		expect( image ).toHaveClass( 'cortext-document-icon--image' );
		expect( image ).toHaveAttribute(
			'src',
			'https://example.test/thumb.jpg'
		);
		expect( image ).toHaveAttribute( 'width', '28' );
		expect( image ).toHaveAttribute( 'height', '28' );
		expect( image ).toHaveAttribute( 'loading', 'lazy' );
		expect( image ).toHaveAttribute( 'decoding', 'async' );
		expect( image ).toHaveStyle( { opacity: '0' } );

		fireEvent.load( image );

		expect(
			wrapper.querySelector( '.cortext-document-icon--image-loading' )
		).not.toBeInTheDocument();
		expect( image ).toHaveStyle( { opacity: '1' } );
	} );

	it( 'keeps glyph svgs from shrinking in flex containers', () => {
		const stylesheet = readFileSync(
			join( process.cwd(), 'src/components/DocumentIcon.scss' ),
			'utf8'
		);

		expect( stylesheet ).toContain(
			'min-width: var(--cortext-document-icon-glyph-size);'
		);
		expect( stylesheet ).toContain(
			'flex: 0 0 var(--cortext-document-icon-glyph-size);'
		);
		expect( stylesheet ).toContain( 'max-width: none;' );
	} );
} );
