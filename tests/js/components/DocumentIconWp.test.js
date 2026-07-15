import { render } from '@testing-library/react';

import DocumentIconWp from '../../../src/components/DocumentIconWp';

describe( 'DocumentIconWp', () => {
	it( 'renders the Cortext collection glyph used by public document icons', () => {
		const { container } = render(
			<DocumentIconWp name="collection" size={ 44 } />
		);

		const svg = container.querySelector( 'svg' );
		expect( svg ).toBeInTheDocument();
		expect( svg ).toHaveAttribute( 'width', '44' );
		expect( svg ).toHaveAttribute( 'height', '44' );
	} );

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
