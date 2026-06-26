/**
 * Tests for `src/components/RevisionsHeader.js`.
 *
 * The header drives the native revisions mode. The key behavior beyond toggling
 * the diff and exiting is the restore guard: restoring writes server-side and
 * resets the editor, so it must be blocked (with a reason) while the document is
 * trashed, dirty, or saving.
 */
import { fireEvent, render, screen, within } from '@testing-library/react';

const mockUseRevisionControls = jest.fn();

jest.mock( '../../../src/hooks/useRevisions', () => ( {
	__esModule: true,
	useRevisionControls: ( ...args ) => mockUseRevisionControls( ...args ),
} ) );

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Button: ( { children, disabled, isBusy, isPressed, label, onClick } ) => (
		<button
			aria-label={ label }
			aria-pressed={ isPressed ? 'true' : undefined }
			disabled={ disabled || isBusy }
			onClick={ onClick }
			type="button"
		>
			{ children ?? label }
		</button>
	),
	__experimentalConfirmDialog: ( {
		children,
		confirmButtonText,
		onCancel,
		onConfirm,
	} ) => (
		<div role="dialog">
			<p>{ children }</p>
			<button type="button" onClick={ onConfirm }>
				{ confirmButtonText }
			</button>
			<button type="button" onClick={ onCancel }>
				cancel
			</button>
		</div>
	),
} ) );

jest.mock( '@wordpress/date', () => ( {
	__esModule: true,
	dateI18n: ( format, value ) => String( value ),
	getDate: ( value ) => value,
	getSettings: () => ( { formats: { datetimeAbbreviated: 'M j' } } ),
} ) );

jest.mock( '@wordpress/icons', () => ( {
	__esModule: true,
	closeSmall: 'closeSmall',
	reset: 'reset',
	seen: 'seen',
	unseen: 'unseen',
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__esModule: true,
	__: ( text ) => text,
	sprintf: ( text, value ) => text.replace( '%s', value ),
} ) );

import RevisionsHeader from '../../../src/components/RevisionsHeader';

function controls( overrides = {} ) {
	return {
		canRestore: true,
		currentRevision: { date: '2026-06-01T00:00:00' },
		exitRevisions: jest.fn(),
		isDirty: false,
		isRestoring: false,
		isSaving: false,
		isShowingRevisionDiff: false,
		isTrashed: false,
		restoreRevision: jest.fn().mockResolvedValue( {} ),
		toggleDiff: jest.fn(),
		...overrides,
	};
}

function renderHeader( overrides ) {
	const value = controls( overrides );
	mockUseRevisionControls.mockReturnValue( value );
	render( <RevisionsHeader postId={ 7 } postType="crtxt_document" /> );
	return value;
}

describe( 'RevisionsHeader', () => {
	beforeEach( () => {
		jest.clearAllMocks();
	} );

	it( 'enables Restore on a clean document', () => {
		renderHeader();
		expect( screen.getByText( 'Restore' ) ).toBeEnabled();
	} );

	it( 'blocks Restore with unsaved edits and explains why', () => {
		renderHeader( { canRestore: false, isDirty: true } );

		expect( screen.getByText( 'Restore' ) ).toBeDisabled();
		expect(
			screen.getByLabelText(
				'Save your changes first, then restore the revision.'
			)
		).toBeInTheDocument();
	} );

	it( 'blocks Restore on a trashed document and explains why', () => {
		renderHeader( { canRestore: false, isTrashed: true } );

		expect( screen.getByText( 'Restore' ) ).toBeDisabled();
		expect(
			screen.getByLabelText(
				'Take this page out of Trash before restoring a revision.'
			)
		).toBeInTheDocument();
	} );

	it( 'restores after confirmation', () => {
		const value = renderHeader();

		fireEvent.click( screen.getByText( 'Restore' ) );
		const dialog = screen.getByRole( 'dialog' );
		fireEvent.click( within( dialog ).getByText( 'Restore' ) );

		expect( value.restoreRevision ).toHaveBeenCalled();
	} );

	it( 'toggles the diff highlight', () => {
		const value = renderHeader();

		fireEvent.click( screen.getByLabelText( 'Show changes' ) );

		expect( value.toggleDiff ).toHaveBeenCalled();
	} );
} );
