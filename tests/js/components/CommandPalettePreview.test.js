import { act, render, screen } from '@testing-library/react';

const mockUseEntityRecord = jest.fn();
const mockBlockPreview = jest.fn();
const mockParse = jest.fn();

jest.mock( '@wordpress/core-data', () => ( {
	useEntityRecord: ( ...args ) => mockUseEntityRecord( ...args ),
} ) );

jest.mock( '../../../src/lock-unlock', () => ( {
	unlock: ( apis ) => apis,
} ) );

jest.mock( '@wordpress/block-editor', () => ( {
	BlockContextProvider: ( { children } ) => children,
	BlockPreview: ( props ) => {
		mockBlockPreview( props );
		return <div data-testid="block-preview" />;
	},
	privateApis: {
		ExperimentalBlockEditorProvider: ( { children } ) => children,
	},
} ) );

jest.mock( '@wordpress/blocks', () => ( {
	parse: ( ...args ) => mockParse( ...args ),
} ) );

jest.mock( '@wordpress/date', () => ( {
	dateI18n: ( format, value ) => `date(${ value })`,
	getSettings: () => ( { formats: { date: 'F j, Y' } } ),
} ) );

jest.mock( '../../../src/components/initEditor', () => ( {
	__esModule: true,
	getEditorSettings: () => ( { styles: [] } ),
} ) );

jest.mock( '../../../src/components/DocumentIcon', () => () => null );

import CommandPalettePreview, {
	stripPreviewBlocks,
} from '../../../src/components/CommandPalettePreview';

const PAGE_DOC = { id: 42, title: 'Roadmap', path: 'roadmap-42' };

function block( name, innerBlocks = [] ) {
	return { name, attributes: {}, innerBlocks };
}

function recordFor( id, extra = {} ) {
	return {
		record: {
			id,
			content: { raw: 'blocks' },
			modified: '2026-03-04T10:00:00',
			...extra,
		},
		hasResolved: true,
	};
}

// Wait for the dynamically imported editor chunk before checking the body.
async function renderPreview( doc = PAGE_DOC ) {
	let result;
	await act( async () => {
		result = render( <CommandPalettePreview doc={ doc } /> );
	} );
	return result;
}

beforeEach( () => {
	jest.useFakeTimers();
	mockUseEntityRecord.mockReset();
	mockUseEntityRecord.mockReturnValue( { record: null, hasResolved: false } );
	mockBlockPreview.mockReset();
	mockParse.mockReset();
	mockParse.mockReturnValue( [ block( 'core/paragraph' ) ] );
} );

afterEach( () => {
	jest.useRealTimers();
} );

describe( 'stripPreviewBlocks', () => {
	it( 'removes header and data-view blocks recursively', () => {
		const blocks = [
			block( 'core/post-title' ),
			block( 'cortext/document-icon' ),
			block( 'cortext/document-cover' ),
			block( 'cortext/document-properties' ),
			block( 'core/paragraph' ),
			block( 'core/group', [
				block( 'cortext/data-view' ),
				block( 'core/heading' ),
			] ),
		];

		expect( stripPreviewBlocks( blocks ) ).toEqual( [
			block( 'core/paragraph' ),
			block( 'core/group', [ block( 'core/heading' ) ] ),
		] );
	} );
} );

describe( 'CommandPalettePreview', () => {
	it( 'uses the search result title and collection while the record loads', async () => {
		const { container } = await renderPreview( {
			id: 77,
			title: 'Ship the thing',
			path: 'ship-the-thing-77',
			collection: { id: 9, title: 'Projects', path: 'projects-9' },
		} );

		expect( screen.getByText( 'Ship the thing' ) ).toBeInTheDocument();
		expect( screen.getByText( 'in Projects' ) ).toBeInTheDocument();
		expect(
			container.querySelector( '[data-testid="block-preview"]' )
		).toBeNull();

		// Delay the skeleton so cached records do not flash a loading state.
		expect(
			container.querySelector(
				'.cortext-command-palette__preview-skeleton'
			)
		).toBeNull();

		act( () => {
			jest.advanceTimersByTime( 120 );
		} );

		expect(
			container.querySelector(
				'.cortext-command-palette__preview-skeleton'
			)
		).not.toBeNull();
	} );

	it( 'renders the filtered body and edit date after the record loads', async () => {
		mockUseEntityRecord.mockReturnValue( recordFor( 42 ) );
		mockParse.mockReturnValue( [
			block( 'core/post-title' ),
			block( 'core/paragraph' ),
		] );

		await renderPreview();

		expect( screen.getByTestId( 'block-preview' ) ).toBeInTheDocument();
		expect(
			screen.getByText( 'Edited date(2026-03-04T10:00:00)' )
		).toBeInTheDocument();
		expect( mockBlockPreview ).toHaveBeenCalledWith(
			expect.objectContaining( { blocks: [ block( 'core/paragraph' ) ] } )
		);
	} );

	it( 'renders at most 40 top-level blocks', async () => {
		mockUseEntityRecord.mockReturnValue( recordFor( 42 ) );
		mockParse.mockReturnValue(
			Array.from( { length: 60 }, () => block( 'core/paragraph' ) )
		);

		await renderPreview();

		expect( mockBlockPreview.mock.calls[ 0 ][ 0 ].blocks ).toHaveLength(
			40
		);
	} );

	it( 'shows only the header when the document has no previewable blocks', async () => {
		mockUseEntityRecord.mockReturnValue( recordFor( 42 ) );
		mockParse.mockReturnValue( [ block( 'cortext/data-view' ) ] );

		const { container } = await renderPreview();

		expect(
			container.querySelector( '[data-testid="block-preview"]' )
		).toBeNull();
		expect( screen.getByText( 'Roadmap' ) ).toBeInTheDocument();
	} );

	it( "uses the document's featured image as the cover", async () => {
		mockUseEntityRecord.mockImplementation( ( kind, name, id ) => {
			if ( kind === 'root' ) {
				return {
					record: {
						id,
						media_details: {
							sizes: { large: { source_url: 'https://x/l.jpg' } },
						},
					},
					hasResolved: true,
				};
			}
			return recordFor( id, { featured_media: 7 } );
		} );

		const { container } = await renderPreview();

		expect( mockUseEntityRecord ).toHaveBeenCalledWith(
			'root',
			'media',
			7
		);
		expect(
			container.querySelector( '.cortext-command-palette__preview-cover' )
		).toHaveAttribute( 'src', 'https://x/l.jpg' );
	} );

	it( 'falls back to the search excerpt when the record cannot be loaded', async () => {
		mockUseEntityRecord.mockReturnValue( {
			record: null,
			hasResolved: true,
		} );

		await renderPreview( { ...PAGE_DOC, excerpt: 'Quarterly themes.' } );

		expect( screen.getByText( 'Quarterly themes.' ) ).toBeInTheDocument();
	} );

	it( 'loads the highlighted document through core-data', async () => {
		mockUseEntityRecord.mockReturnValue( recordFor( 42 ) );

		const { rerender } = await renderPreview();

		expect( mockUseEntityRecord ).toHaveBeenLastCalledWith(
			'postType',
			'crtxt_document',
			42,
			{ enabled: true }
		);

		// Request the next document immediately so a cached record can resolve
		// in the same render.
		rerender( <CommandPalettePreview doc={ { id: 77, title: 'Bob' } } /> );

		expect( mockUseEntityRecord ).toHaveBeenLastCalledWith(
			'postType',
			'crtxt_document',
			77,
			{ enabled: true }
		);
	} );
} );
