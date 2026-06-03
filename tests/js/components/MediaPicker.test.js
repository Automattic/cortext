jest.mock( '@wordpress/block-editor', () => ( {
	MediaUploadCheck: ( { children } ) => children,
} ) );

import { getHostWp } from '../../../src/components/MediaPicker';

describe( 'getHostWp', () => {
	it( 'uses media from the current window first', () => {
		const currentWp = { media: jest.fn() };
		const parentWp = { media: jest.fn() };
		const parentWindow = { wp: parentWp };
		parentWindow.parent = parentWindow;

		const currentWindow = {
			wp: currentWp,
			parent: parentWindow,
		};

		expect( getHostWp( currentWindow ) ).toBe( currentWp );
	} );

	it( 'falls back to the parent window', () => {
		const parentWp = { media: jest.fn() };
		const parentWindow = { wp: parentWp };
		parentWindow.parent = parentWindow;

		const currentWindow = {
			wp: {},
			parent: parentWindow,
		};

		expect( getHostWp( currentWindow ) ).toBe( parentWp );
	} );

	it( 'does not crash on cross-origin parents', () => {
		const currentWindow = {
			wp: {},
			get parent() {
				throw new Error( 'Cross-origin parent' );
			},
		};

		expect( getHostWp( currentWindow ) ).toBeNull();
	} );
} );
