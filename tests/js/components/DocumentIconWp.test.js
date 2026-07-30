import { render } from '@testing-library/react';

import DocumentIconWp from '../../../src/components/DocumentIconWp';
import { CORTEXT_GLYPHS } from '../../../src/components/cortextIcons';

describe( 'DocumentIconWp', () => {
	it.each( Object.entries( CORTEXT_GLYPHS ) )(
		'renders the shared Cortext %s glyph',
		( name, glyph ) => {
			const { container } = render(
				<DocumentIconWp name={ name } size={ 44 } />
			);
			const { container: expectedContainer } = render( glyph );

			const svg = container.querySelector( 'svg' );
			const expectedSvg = expectedContainer.querySelector( 'svg' );
			expect( svg ).toBeInTheDocument();
			expect( svg ).toHaveAttribute( 'width', '44' );
			expect( svg ).toHaveAttribute( 'height', '44' );
			expect( svg ).toHaveAttribute(
				'viewBox',
				expectedSvg.getAttribute( 'viewBox' )
			);
			expect( svg.innerHTML ).toBe( expectedSvg.innerHTML );
		}
	);

	it( 'keeps rendering WordPress icon names', () => {
		const { container } = render( <DocumentIconWp name="page" /> );

		expect( container.querySelector( 'svg' ) ).toBeInTheDocument();
	} );

	it( 'renders nothing for unknown glyph names', () => {
		const { container } = render(
			<DocumentIconWp name="not-a-real-glyph" />
		);

		expect( container ).toBeEmptyDOMElement();
	} );
} );
