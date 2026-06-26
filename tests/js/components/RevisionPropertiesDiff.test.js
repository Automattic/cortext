/**
 * Tests for `src/components/RevisionPropertiesDiff.js`.
 *
 * Covers the pure value helpers and the rendered panel, which diffs the current
 * revision's `meta` against the previous revision's `meta`, mapping each
 * `field-<id>` key to its human label. Rollups are computed, never stored in a
 * revision, so they must never appear.
 */
import { render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	PanelBody: ( { children, title } ) => (
		<section aria-label={ title }>{ children }</section>
	),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__esModule: true,
	__: ( text ) => text,
	sprintf: ( text, ...args ) => {
		let index = 0;
		return text.replace( /%[ds]/g, () => String( args[ index++ ] ) );
	},
} ) );

const mockUseRevisionControls = jest.fn();
const mockUseDocumentPropertiesContext = jest.fn();

jest.mock( '../../../src/hooks/useRevisions', () => ( {
	__esModule: true,
	useRevisionControls: ( ...args ) => mockUseRevisionControls( ...args ),
} ) );

jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	__esModule: true,
	useDocumentPropertiesContext: ( ...args ) =>
		mockUseDocumentPropertiesContext( ...args ),
} ) );

import RevisionPropertiesDiff, {
	displayValues,
	metaValues,
	valuesEqual,
} from '../../../src/components/RevisionPropertiesDiff';

describe( 'RevisionPropertiesDiff helpers', () => {
	it( 'normalizes meta to an array', () => {
		expect( metaValues( { 'field-1': 'a' }, 'field-1' ) ).toEqual( [
			'a',
		] );
		expect( metaValues( { 'field-1': [ 'a', 'b' ] }, 'field-1' ) ).toEqual(
			[ 'a', 'b' ]
		);
		expect( metaValues( {}, 'field-1' ) ).toEqual( [] );
		expect( metaValues( null, 'field-1' ) ).toEqual( [] );
	} );

	it( 'compares values by content', () => {
		expect( valuesEqual( [ 'a' ], [ 'a' ] ) ).toBe( true );
		expect( valuesEqual( [ 'a' ], [ 'b' ] ) ).toBe( false );
		expect( valuesEqual( undefined, [] ) ).toBe( true );
	} );

	it( 'formats empty, list, and checkbox values', () => {
		expect( displayValues( [], {} ) ).toBe( 'Empty' );
		expect( displayValues( [ 'a', 'b' ], {} ) ).toBe( 'a, b' );
		expect(
			displayValues( [ '1' ], { cortextFieldType: 'checkbox' } )
		).toBe( 'Yes' );
		expect(
			displayValues( [ '' ], { cortextFieldType: 'checkbox' } )
		).toBe( 'No' );
	} );
} );

describe( 'RevisionPropertiesDiff', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'lists only changed, non-rollup properties', () => {
		mockUseDocumentPropertiesContext.mockReturnValue( {
			fields: [
				{ id: 'field-1', label: 'Name', cortextFieldType: 'text' },
				{ id: 'field-2', label: 'Status', cortextFieldType: 'text' },
				{ id: 'field-3', label: 'Total', cortextFieldType: 'rollup' },
			],
		} );
		mockUseRevisionControls.mockReturnValue( {
			currentRevision: {
				meta: { 'field-1': 'new', 'field-2': 'same', 'field-3': '9' },
			},
			previousRevision: {
				meta: { 'field-1': 'old', 'field-2': 'same', 'field-3': '1' },
			},
		} );

		render( <RevisionPropertiesDiff /> );

		expect( screen.getByText( 'Name' ) ).toBeInTheDocument();
		expect( screen.getByText( 'old' ) ).toBeInTheDocument();
		expect( screen.getByText( 'new' ) ).toBeInTheDocument();
		// Unchanged field and rollup field are both omitted.
		expect( screen.queryByText( 'Status' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Total' ) ).not.toBeInTheDocument();
	} );

	it( 'renders nothing without fields or a revision', () => {
		mockUseDocumentPropertiesContext.mockReturnValue( { fields: [] } );
		mockUseRevisionControls.mockReturnValue( {
			currentRevision: { meta: {} },
		} );

		const { container } = render( <RevisionPropertiesDiff /> );
		expect( container ).toBeEmptyDOMElement();
	} );
} );
