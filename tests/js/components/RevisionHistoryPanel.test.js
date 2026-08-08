/**
 * Tests for `src/components/RevisionHistoryPanel.js`.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';

const mockExitRevisions = jest.fn();
const mockSelectRevision = jest.fn();
const mockUseEntityRecord = jest.fn();
const mockUseRevisionControls = jest.fn();
const mockUseRevisions = jest.fn();
const mockUseSelect = jest.fn();

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Button: ( {
		'aria-current': ariaCurrent,
		children,
		isPressed,
		onClick,
	} ) => (
		<button
			aria-current={ ariaCurrent }
			aria-pressed={ isPressed ? 'true' : 'false' }
			onClick={ onClick }
			type="button"
		>
			{ children }
		</button>
	),
	Spinner: () => <span>Loading</span>,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityRecord: ( ...args ) => mockUseEntityRecord( ...args ),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useSelect: ( ...args ) => mockUseSelect( ...args ),
} ) );

jest.mock( '@wordpress/date', () => ( {
	__esModule: true,
	dateI18n: ( format, value ) => value.toISOString(),
	getDate: ( value ) => new Date( value ?? '2026-07-14T12:00:00.000Z' ),
	getSettings: () => ( {
		formats: { datetime: 'full', datetimeAbbreviated: 'short' },
	} ),
	humanTimeDiff: () => 'recently',
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__esModule: true,
	__: ( text ) => text,
	sprintf: ( text, value ) => text.replace( '%d', value ),
} ) );

jest.mock( '@wordpress/interface', () => ( {
	__esModule: true,
	ComplementaryArea: ( { children, header } ) => (
		<aside>
			{ header }
			{ children }
		</aside>
	),
	store: {},
} ) );

jest.mock( '../../../src/hooks/useRevisions', () => ( {
	__esModule: true,
	useRevisionAuthor: ( authorId ) => ( {
		user: { name: `Author ${ authorId }` },
	} ),
	useRevisionControls: ( ...args ) => mockUseRevisionControls( ...args ),
	useRevisions: ( ...args ) => mockUseRevisions( ...args ),
} ) );

import {
	DOCUMENT_INSPECTOR,
	REVISION_HISTORY_PANEL,
} from '../../../src/components/editorPanelConstants';
import RevisionHistoryPanel from '../../../src/components/RevisionHistoryPanel';

function revision( id, date, author ) {
	return { id, date, author };
}

function setDefaults( overrides = {} ) {
	mockUseEntityRecord.mockReturnValue( {
		record: {
			author: 3,
			modified: '2026-07-14T11:55:00.000Z',
		},
	} );
	mockUseRevisions.mockReturnValue( {
		data: [
			revision( 11, '2026-07-14T11:00:00.000Z', 3 ),
			revision( 10, '2026-07-13T11:00:00.000Z', 2 ),
		],
		error: null,
		hasResolved: true,
		isLoading: false,
		revisionKey: 'id',
	} );
	mockUseRevisionControls.mockReturnValue( {
		currentRevisionId: null,
		exitRevisions: mockExitRevisions,
		isAvailable: true,
		selectRevision: mockSelectRevision,
		...overrides,
	} );
	mockUseSelect.mockReturnValue( REVISION_HISTORY_PANEL );
}

describe( 'RevisionHistoryPanel', () => {
	beforeEach( () => {
		jest.clearAllMocks();
		setDefaults();
	} );

	it( 'represents the live document separately from retained revisions', () => {
		render(
			<RevisionHistoryPanel postId={ 7 } postType="crtxt_document" />
		);

		const list = screen.getByRole( 'list', {
			name: 'Versions for document 7',
		} );
		expect( within( list ).getAllByRole( 'button' ) ).toHaveLength( 3 );
		expect( screen.getByText( 'Current' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Latest revision' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'listbox' ) ).not.toBeInTheDocument();

		fireEvent.click( screen.getByText( 'Current' ).closest( 'button' ) );
		expect( mockExitRevisions ).toHaveBeenCalled();

		fireEvent.click(
			screen.getByText( 'Latest revision' ).closest( 'button' )
		);
		expect( mockSelectRevision ).toHaveBeenCalledWith( 11 );
	} );

	it( 'keeps revision mode active while showing property differences', () => {
		mockUseSelect.mockReturnValue( DOCUMENT_INSPECTOR );
		setDefaults( { currentRevisionId: 11 } );
		mockUseSelect.mockReturnValue( DOCUMENT_INSPECTOR );

		render(
			<RevisionHistoryPanel postId={ 7 } postType="crtxt_document" />
		);

		expect( mockExitRevisions ).not.toHaveBeenCalled();
	} );

	it( 'exits revision mode when its sidebar is closed', () => {
		setDefaults( { currentRevisionId: 11 } );
		mockUseSelect.mockReturnValue( null );

		render(
			<RevisionHistoryPanel postId={ 7 } postType="crtxt_document" />
		);

		expect( mockExitRevisions ).toHaveBeenCalled();
	} );
} );
