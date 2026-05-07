import { render } from '@testing-library/react';
import { table } from '@wordpress/icons';

import {
	CommandIcon,
	splitPaletteCommands,
} from '../../../src/components/CortextCommandMenu';

describe( 'splitPaletteCommands', () => {
	it( 'separates Cortext recents from the rest of the palette commands', () => {
		const home = { name: 'cortext/home', label: 'Go to home' };
		const page = { name: 'cortext/recent/page-7', label: 'Notes' };
		const row = {
			name: 'cortext/recent/row-12',
			label: 'Ada Lovelace in People',
		};

		expect( splitPaletteCommands( [ home, page, row ] ) ).toEqual( {
			recentCommands: [ page, row ],
			commands: [ home ],
		} );
	} );
} );

describe( 'CommandIcon', () => {
	it( 'sizes raw WordPress icon elements before rendering them', () => {
		const { container } = render( <CommandIcon icon={ table } /> );

		const icon = container.querySelector( 'svg' );
		expect( icon ).toHaveAttribute( 'width', '16' );
		expect( icon ).toHaveAttribute( 'height', '16' );
	} );
} );
