/**
 * Tests for `src/components/RevisionRestoreChanges.js`.
 *
 * The panel compares the row's current values with the selected revision's,
 * which is what a restore overwrites.
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
let mockEditorMeta = {};

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useSelect: ( mapSelect ) =>
		mapSelect( () => ( {
			getEditedPostAttribute: () => mockEditorMeta,
		} ) ),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	__esModule: true,
	store: 'editor',
} ) );

jest.mock( '../../../src/hooks/useRevisions', () => ( {
	__esModule: true,
	useRevisionControls: ( ...args ) => mockUseRevisionControls( ...args ),
} ) );

jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	__esModule: true,
	useDocumentPropertiesContext: ( ...args ) =>
		mockUseDocumentPropertiesContext( ...args ),
} ) );

import RevisionRestoreChanges from '../../../src/components/RevisionRestoreChanges';

const FIELDS = [
	{ id: 'field-1', label: 'Status', cortextFieldType: 'text' },
	{ id: 'field-2', label: 'Owner', cortextFieldType: 'text' },
	{ id: 'field-3', label: 'Total', cortextFieldType: 'rollup' },
];

describe( 'RevisionRestoreChanges', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		mockEditorMeta = {};
		mockUseDocumentPropertiesContext.mockReturnValue( { fields: FIELDS } );
	} );

	it( 'lists the properties a restore would overwrite', () => {
		mockEditorMeta = { 'field-1': 'Done', 'field-2': 'Ana' };
		mockUseRevisionControls.mockReturnValue( {
			currentRevision: {
				cortext_carries_meta: true,
				meta: { 'field-1': 'Todo', 'field-2': 'Ana', 'field-3': '9' },
			},
		} );

		render( <RevisionRestoreChanges /> );

		expect(
			screen.getByRole( 'region', { name: 'Restoring will change (1)' } )
		).toBeInTheDocument();
		expect( screen.getByText( 'Status' ) ).toBeInTheDocument();
		// The row's value goes, the revision's value comes back.
		expect( screen.getByText( 'Done' ).tagName ).toBe( 'DEL' );
		expect( screen.getByText( 'Todo' ).tagName ).toBe( 'INS' );
		// Unchanged and computed properties stay out.
		expect( screen.queryByText( 'Owner' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'Total' ) ).not.toBeInTheDocument();
	} );

	it( 'reads the row record ahead of the editor copy', () => {
		mockEditorMeta = { 'field-1': 'Stale' };
		mockUseDocumentPropertiesContext.mockReturnValue( {
			fields: FIELDS,
			fallbackRecord: { meta: { 'field-1': 'Todo' } },
		} );
		mockUseRevisionControls.mockReturnValue( {
			currentRevision: {
				cortext_carries_meta: true,
				meta: { 'field-1': 'Todo' },
			},
		} );

		render( <RevisionRestoreChanges /> );

		expect(
			screen.getByText(
				'Restoring this revision leaves properties as they are.'
			)
		).toBeInTheDocument();
	} );

	it( 'reports no changes for a revision that restores content only', () => {
		mockEditorMeta = { 'field-1': 'Done' };
		mockUseRevisionControls.mockReturnValue( {
			currentRevision: {
				cortext_carries_meta: false,
				// What REST reports for a revision with no stored metadata.
				meta: { 'field-1': '', 'field-2': '' },
			},
		} );

		render( <RevisionRestoreChanges /> );

		expect(
			screen.getByRole( 'region', { name: 'Restoring will change (0)' } )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'This version predates property history, so restoring it leaves properties as they are.'
			)
		).toBeInTheDocument();
		expect( screen.queryByText( 'Status' ) ).not.toBeInTheDocument();
	} );

	it( 'renders nothing without fields or a revision', () => {
		mockUseDocumentPropertiesContext.mockReturnValue( { fields: [] } );
		mockUseRevisionControls.mockReturnValue( {
			currentRevision: { meta: {} },
		} );

		const { container } = render( <RevisionRestoreChanges /> );
		expect( container ).toBeEmptyDOMElement();
	} );
} );
