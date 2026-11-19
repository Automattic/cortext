/**
 * Tests for `src/components/lifecycle/LifecycleNotice.js`, the banner over a
 * trashed document.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

jest.mock( '@wordpress/components', () => {
	const ReactLib = require( 'react' );
	const Notice = ( { children, actions = [] } ) =>
		ReactLib.createElement(
			'div',
			{ role: 'status' },
			children,
			actions.map( ( action ) =>
				ReactLib.createElement(
					'button',
					{
						key: action.label,
						onClick: action.onClick,
						disabled: action.disabled,
					},
					action.label
				)
			)
		);
	const ConfirmDialog = ( { children, onConfirm, confirmButtonText } ) =>
		ReactLib.createElement(
			'div',
			{ role: 'dialog' },
			children,
			ReactLib.createElement(
				'button',
				{ onClick: onConfirm, 'data-testid': 'confirm-dialog-confirm' },
				confirmButtonText
			)
		);
	return {
		__esModule: true,
		Notice,
		__experimentalConfirmDialog: ConfirmDialog,
	};
} );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	store: 'core',
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: () => mockDispatch,
	useSelect: () => null,
} ) );

jest.mock( '@wordpress/date', () => ( {
	__esModule: true,
	humanTimeDiff: () => '2 hours ago',
} ) );

jest.mock( '@tanstack/react-router', () => ( {
	__esModule: true,
	useNavigate: () => mockNavigate,
	useParams: () => ( { _splat: mockSplat } ),
} ) );

jest.mock( '../../../../src/components/lifecycle/useLifecycleDetails', () => ( {
	__esModule: true,
	default: () => mockDetails,
} ) );

jest.mock( '../../../../src/documents/actions', () => ( {
	__esModule: true,
	permanentlyDeleteDocument: jest.fn(),
	restoreDocument: jest.fn(),
} ) );

jest.mock( '../../../../src/components/TypeToConfirmDialog', () => {
	const ReactLib = require( 'react' );
	return {
		__esModule: true,
		default: ( { confirmPhrase, onConfirm } ) =>
			ReactLib.createElement(
				'div',
				{ role: 'dialog', 'data-testid': 'type-to-confirm' },
				confirmPhrase,
				ReactLib.createElement(
					'button',
					{
						onClick: onConfirm,
						'data-testid': 'type-to-confirm-confirm',
					},
					'Delete permanently'
				)
			),
	};
} );

import {
	permanentlyDeleteDocument,
	restoreDocument,
} from '../../../../src/documents/actions';
import TrashedNotice from '../../../../src/components/lifecycle/LifecycleNotice';

let mockDetails;
let mockSplat;
const mockNavigate = jest.fn();
const mockDispatch = {
	createErrorNotice: jest.fn(),
	createSuccessNotice: jest.fn(),
	invalidateResolution: jest.fn(),
	receiveEntityRecords: jest.fn(),
};

function details( overrides = {} ) {
	return {
		record: {
			id: 7,
			title: 'Reading notes',
			crtxt_trait: [],
			cortext_defines_trait: false,
			trashed_at: '2026-11-18T10:00:00+00:00',
			purge_at: new Date( Date.now() + 27.5 * 86400000 ).toISOString(),
		},
		nestedCount: 3,
		path: [ 'Library', 'Reading' ],
		byName: 'maria',
		...overrides,
	};
}

beforeEach( () => {
	jest.clearAllMocks();
	mockDetails = details();
	mockSplat = 'trash/7';
} );

function renderNotice( onRestored = jest.fn() ) {
	render(
		<TrashedNotice
			postId={ 7 }
			postType="crtxt_document"
			onRestored={ onRestored }
		/>
	);
	return onRestored;
}

describe( 'TrashedNotice', () => {
	it( 'says when and by whom it was deleted, when it goes for good and what comes back', () => {
		renderNotice();

		expect(
			screen.getByText( 'This document is in the Trash.' )
		).toBeInTheDocument();
		expect(
			screen.getByText(
				'Deleted 2 hours ago by maria, permanently in 28 days · 3 nested documents come back with it'
			)
		).toBeInTheDocument();
	} );

	it( 'restores to where it was', async () => {
		restoreDocument.mockResolvedValue( { post: { id: 7 } } );
		const onRestored = renderNotice();

		await act( async () => {
			fireEvent.click(
				screen.getByRole( 'button', { name: 'Restore to Reading' } )
			);
		} );

		expect( restoreDocument ).toHaveBeenCalledWith(
			mockDetails.record,
			expect.objectContaining( {
				createSuccessNotice: mockDispatch.createSuccessNotice,
			} )
		);
		expect( onRestored ).toHaveBeenCalledWith( 7, 'crtxt_document', {
			post: { id: 7 },
		} );
	} );

	it( 'restores a top-level document without naming a parent', () => {
		mockDetails = details( { path: [], nestedCount: 0, byName: '' } );
		renderNotice();

		expect(
			screen.getByText( 'Deleted 2 hours ago, permanently in 28 days' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', { name: 'Restore' } )
		).toBeInTheDocument();
	} );

	it( 'still offers Restore before the Trash details load', () => {
		mockDetails = null;
		renderNotice();

		expect(
			screen.getByRole( 'button', { name: 'Restore' } )
		).toBeEnabled();
		expect(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		).toBeDisabled();
	} );

	it( 'deletes for good after typing the title, then goes back to Trash', async () => {
		permanentlyDeleteDocument.mockResolvedValue( { deleted: [ 7 ] } );
		renderNotice();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		expect( screen.getByTestId( 'type-to-confirm' ) ).toHaveTextContent(
			'Reading notes'
		);
		await act( async () => {
			fireEvent.click( screen.getByTestId( 'type-to-confirm-confirm' ) );
		} );

		expect( permanentlyDeleteDocument ).toHaveBeenCalledWith(
			mockDetails.record,
			expect.anything()
		);
		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'trash' },
			replace: true,
		} );
	} );

	it( 'goes home after deleting a document opened from a link', async () => {
		mockSplat = 'reading-notes-7';
		mockDetails = details( { nestedCount: 0 } );
		permanentlyDeleteDocument.mockResolvedValue( { deleted: [ 7 ] } );
		renderNotice();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		await act( async () => {
			fireEvent.click( screen.getByTestId( 'confirm-dialog-confirm' ) );
		} );

		expect( mockNavigate ).toHaveBeenCalledWith( { to: '/' } );
	} );
} );
