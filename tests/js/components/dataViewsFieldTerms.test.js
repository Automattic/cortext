import { __ } from '@wordpress/i18n';

import '../../../src/components/dataViewsFieldTerms';

describe( 'DataViews field terms', () => {
	it( 'renames the DataViews header item', () => {
		expect( __( 'Hide column' ) ).toBe( 'Hide in view' );
		expect( __( 'Properties' ) ).toBe( 'Properties' );
	} );

	it( 'leaves other strings and text domains alone', () => {
		expect( __( 'Move left' ) ).toBe( 'Move left' );
		expect( __( 'Properties', 'cortext' ) ).toBe( 'Properties' );
	} );
} );
