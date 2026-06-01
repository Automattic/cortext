jest.mock( '@wordpress/data', () => ( {
	useSelect: jest.fn(),
	useDispatch: jest.fn(),
} ) );
jest.mock( '@wordpress/block-editor', () => ( {
	store: 'core/block-editor',
} ) );

import { render } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';

import CortextLinkSuggestions from '../../../src/components/CortextLinkSuggestions';
import { fetchCortextLinkSuggestions } from '../../../src/components/fetchCortextLinkSuggestions';

let updateSettings;

beforeEach( () => {
	jest.clearAllMocks();
	updateSettings = jest.fn();
	useDispatch.mockReturnValue( { updateSettings } );
} );

it( 'installs the Cortext fetcher and disables page creation when another handler is active', () => {
	useSelect.mockReturnValue( () => {} );

	render( <CortextLinkSuggestions /> );

	expect( updateSettings ).toHaveBeenCalledWith(
		expect.objectContaining( {
			__experimentalFetchLinkSuggestions: fetchCortextLinkSuggestions,
			__experimentalUserCanCreatePages: false,
		} )
	);
} );

it( 'does nothing when the Cortext fetcher is already installed', () => {
	useSelect.mockReturnValue( fetchCortextLinkSuggestions );

	render( <CortextLinkSuggestions /> );

	expect( updateSettings ).not.toHaveBeenCalled();
} );
