/**
 * Tests for `src/components/mention/traitCompleter.js`: typing `#` in a row
 * offers the collections it doesn't carry yet, and picking one applies the
 * trait and leaves a mention of the collection.
 */

import { renderHook, waitFor } from '@testing-library/react';
import { renderToString } from '@wordpress/element';

jest.mock( '@wordpress/hooks', () => ( {
	addFilter: jest.fn(),
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
} ) );

jest.mock( '@wordpress/editor', () => ( {
	store: 'core/editor',
} ) );

jest.mock( '@wordpress/notices', () => ( {
	store: 'core/notices',
} ) );

const mockInvalidate = jest.fn();
const mockCreateErrorNotice = jest.fn();
jest.mock( '@wordpress/data', () => ( {
	useSelect: ( callback ) =>
		callback( () => ( { getCurrentPostId: () => 7 } ) ),
	useDispatch: () => ( {
		invalidateResolution: mockInvalidate,
		createErrorNotice: mockCreateErrorNotice,
	} ),
} ) );

let mockTraits;
const mockUseDocumentTraits = jest.fn( () => mockTraits );
jest.mock( '../../../src/hooks/useDocumentTraits', () => ( {
	__esModule: true,
	default: ( ...args ) => mockUseDocumentTraits( ...args ),
} ) );

jest.mock( '../../../src/components/fetchCortextLinkSuggestions', () => ( {
	fetchCortextLinkSuggestions: jest.fn(),
} ) );

jest.mock( '../../../src/documents/writeTraits', () => ( {
	writeDocumentTraits: jest.fn(),
} ) );

import { fetchCortextLinkSuggestions } from '../../../src/components/fetchCortextLinkSuggestions';
import { writeDocumentTraits } from '../../../src/documents/writeTraits';
import {
	allowTraitContext,
	getTraitCompletion,
	isTraitSearch,
	traitCompleter,
	withCortextTraitCompleter,
} from '../../../src/components/mention/traitCompleter';

const books = { id: 3, title: 'Books', url: '/books-3', icon: '' };
const tasks = { id: 4, title: 'Tasks', url: '/tasks-4', icon: '' };

function renderItems( filterValue ) {
	return renderHook( () => traitCompleter.useItems( filterValue ) );
}

beforeEach( () => {
	mockTraits = {
		collections: [ { id: 4, title: 'Tasks' } ],
		hasResolved: true,
	};
	mockUseDocumentTraits.mockClear();
	fetchCortextLinkSuggestions.mockReset();
	fetchCortextLinkSuggestions.mockResolvedValue( [ books, tasks ] );
	writeDocumentTraits.mockReset();
	writeDocumentTraits.mockResolvedValue( {} );
	mockCreateErrorNotice.mockReset();
} );

describe( 'trait completer', () => {
	it( 'offers matching collections the row does not carry yet', async () => {
		const { result } = renderItems( 'Bo' );

		await waitFor( () => expect( result.current[ 0 ] ).toHaveLength( 1 ) );
		expect( fetchCortextLinkSuggestions ).toHaveBeenCalledWith( 'Bo', {
			perPage: 10,
			collectionsOnly: true,
		} );
		expect( result.current[ 0 ][ 0 ] ).toMatchObject( {
			key: 'trait-3',
			label: 'Books',
			value: { id: 3, kind: 'document' },
		} );
	} );

	it( 'offers nothing on documents without traits', async () => {
		mockTraits = { collections: [], hasResolved: true };
		const { result } = renderItems( 'Bo' );

		await new Promise( ( resolve ) => setTimeout( resolve, 300 ) );
		expect( fetchCortextLinkSuggestions ).not.toHaveBeenCalled();
		expect( result.current[ 0 ] ).toEqual( [] );
	} );

	it( 'skips numbers without loading traits', async () => {
		const { result } = renderItems( '123' );

		await new Promise( ( resolve ) => setTimeout( resolve, 300 ) );
		expect( mockUseDocumentTraits ).toHaveBeenCalledWith( null );
		expect( fetchCortextLinkSuggestions ).not.toHaveBeenCalled();
		expect( result.current[ 0 ] ).toEqual( [] );
	} );

	it( 'applies the trait with every current membership', async () => {
		const { result } = renderItems( 'Bo' );
		await waitFor( () => expect( result.current[ 0 ] ).toHaveLength( 1 ) );

		const html = renderToString(
			getTraitCompletion( result.current[ 0 ][ 0 ].value )
		);

		expect( writeDocumentTraits ).toHaveBeenCalledWith(
			7,
			[ 4, 3 ],
			mockInvalidate
		);
		expect( html ).toContain( 'data-crtxt-mention="3"' );
		expect( html ).toContain( '>Books</a>' );
	} );

	it( 'shows a notice when the trait could not be added', async () => {
		writeDocumentTraits.mockRejectedValue( new Error( 'nope' ) );
		const { result } = renderItems( 'Bo' );
		await waitFor( () => expect( result.current[ 0 ] ).toHaveLength( 1 ) );

		getTraitCompletion( result.current[ 0 ][ 0 ].value );

		await waitFor( () =>
			expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
				"Couldn't add the trait.",
				{ type: 'snackbar' }
			)
		);
	} );

	it( 'only starts at the start of a word', () => {
		expect( allowTraitContext( '' ) ).toBe( true );
		expect( allowTraitContext( 'Read ' ) ).toBe( true );
		expect( allowTraitContext( 'page' ) ).toBe( false );
		expect( allowTraitContext( 'C' ) ).toBe( false );
	} );

	it( 'treats empty and digit-only searches as no search', () => {
		expect( isTraitSearch( '' ) ).toBe( false );
		expect( isTraitSearch( '2026' ) ).toBe( false );
		expect( isTraitSearch( 'Q3' ) ).toBe( true );
	} );

	it( 'registers once, after the other completers', () => {
		const blockCompleter = { name: 'blocks', triggerPrefix: '/' };

		expect(
			withCortextTraitCompleter( [ traitCompleter, blockCompleter ] )
		).toEqual( [ blockCompleter, traitCompleter ] );
	} );
} );
