jest.mock( '@wordpress/data', () => ( {
	useSelect: jest.fn(),
	useDispatch: jest.fn(),
} ) );
jest.mock( '@wordpress/block-editor', () => ( {
	store: 'core/block-editor',
} ) );
jest.mock( '@wordpress/editor', () => ( { store: 'core/editor' } ) );
jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import { render } from '@testing-library/react';
import { useSelect, useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';

import CortextLinkSuggestions from '../../../src/components/CortextLinkSuggestions';
import { fetchCortextLinkSuggestions } from '../../../src/components/fetchCortextLinkSuggestions';

let updateSettings;

function mockStores( { handler, postId } ) {
	const stores = {
		'core/block-editor': {
			getSettings: () => ( {
				__experimentalFetchLinkSuggestions: handler,
			} ),
		},
		'core/editor': { getCurrentPostId: () => postId },
	};
	useSelect.mockImplementation( ( mapSelect ) =>
		mapSelect( ( store ) => stores[ store ] )
	);
}

beforeEach( () => {
	jest.clearAllMocks();
	updateSettings = jest.fn();
	useDispatch.mockReturnValue( { updateSettings } );
} );

it( 'installs the Cortext fetcher and disables page creation by default', () => {
	mockStores( { handler: () => {}, postId: 10 } );

	render( <CortextLinkSuggestions /> );

	expect( updateSettings ).toHaveBeenCalledWith(
		expect.objectContaining( {
			__experimentalFetchLinkSuggestions: fetchCortextLinkSuggestions,
			__experimentalUserCanCreatePages: false,
			__experimentalCreatePageEntity: undefined,
		} )
	);
} );

it( 'lets the full editor create a Cortext document as a child of the current document', async () => {
	mockStores( { handler: () => {}, postId: 42 } );
	apiFetch.mockResolvedValueOnce( {
		id: 99,
		type: 'crtxt_document',
		title: { rendered: 'New doc' },
		link: 'http://example.test/?post_type=crtxt_document&p=99',
	} );

	render( <CortextLinkSuggestions allowCreate /> );

	const settings = updateSettings.mock.calls.at( -1 )[ 0 ];
	expect( settings.__experimentalUserCanCreatePages ).toBe( true );

	const created = await settings.__experimentalCreatePageEntity( {
		title: 'New doc',
		status: 'draft',
	} );

	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/wp/v2/crtxt_documents',
		method: 'POST',
		data: { title: 'New doc', status: 'draft', parent: 42 },
	} );
	expect( created.id ).toBe( 99 );
	expect( created.link ).toContain( 'p=99' );
} );
