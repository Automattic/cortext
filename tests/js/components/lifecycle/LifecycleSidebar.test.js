/**
 * Tests for `src/components/lifecycle/LifecycleSidebar.js`, as Trash and as
 * Archived.
 *
 * The WordPress data and REST layers are mocked so each case can drive the
 * listed documents, the route selection, and check the requests the view
 * makes.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';

// Stub @wordpress/components so Jest does not pull in rich-text →
// block-editor → parsel-js, an ESM-only package the CJS transformer chokes on.
jest.mock( '@wordpress/components', () => {
	const ReactLib = require( 'react' );
	const Button = ( {
		children,
		onClick,
		label,
		disabled,
		isPressed,
		icon,
		isDestructive,
		variant,
		size,
		...rest
	} ) =>
		ReactLib.createElement(
			'button',
			{
				onClick,
				disabled,
				'aria-label': label,
				'aria-pressed': isPressed,
				...rest,
			},
			children ?? label
		);
	const ConfirmDialog = ( {
		children,
		onConfirm,
		onCancel,
		confirmButtonText,
	} ) =>
		ReactLib.createElement(
			'div',
			{ role: 'dialog' },
			ReactLib.createElement( 'div', null, children ),
			ReactLib.createElement(
				'button',
				{ onClick: onConfirm, 'data-testid': 'confirm-dialog-confirm' },
				confirmButtonText
			),
			ReactLib.createElement( 'button', { onClick: onCancel }, 'Cancel' )
		);
	const SearchControl = ( { value, onChange, label } ) =>
		ReactLib.createElement( 'input', {
			'aria-label': label,
			value,
			onChange: ( event ) => onChange( event.target.value ),
		} );
	const Notice = ( { children } ) =>
		ReactLib.createElement( 'div', { role: 'alert' }, children );
	return {
		__esModule: true,
		Button,
		Icon: () => null,
		Notice,
		SearchControl,
		__experimentalConfirmDialog: ConfirmDialog,
	};
} );

jest.mock( '@wordpress/icons', () => ( {
	__esModule: true,
	box: 'box-icon',
	chevronLeft: 'chevron-left-icon',
	Icon: () => null,
	customPostType: 'custom-post-type-icon',
	rotateLeft: 'rotate-left-icon',
	trash: 'trash-icon',
	page: 'page-icon',
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	store: 'core',
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: jest.fn(),
	useSelect: jest.fn(),
} ) );

jest.mock( '@wordpress/date', () => ( {
	__esModule: true,
	dateI18n: () => 'Today, 14:12',
	getSettings: () => ( { formats: { date: 'F j', time: 'H:i' } } ),
	humanTimeDiff: () => '2 hours ago',
} ) );

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '@tanstack/react-router', () => ( {
	__esModule: true,
	useNavigate: jest.fn(),
} ) );

jest.mock( '../../../../src/components/DocumentIcon', () => ( {
	__esModule: true,
	default: () => null,
} ) );

jest.mock( '../../../../src/hooks/useTrashedDocuments', () => ( {
	__esModule: true,
	default: () => mockTrashState,
} ) );

jest.mock( '../../../../src/hooks/useArchivedDocuments', () => ( {
	__esModule: true,
	default: () => mockTrashState,
} ) );

jest.mock( '../../../../src/hooks/useFavorites', () => ( {
	__esModule: true,
	useFavorites: () => ( { setFavorites: jest.fn() } ),
} ) );

jest.mock( '../../../../src/hooks/useRecents', () => ( {
	__esModule: true,
	useRecents: () => ( { touchRecent: jest.fn() } ),
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

import { useDispatch, useSelect } from '@wordpress/data';
import { useEntityRecords } from '@wordpress/core-data';
import apiFetch from '@wordpress/api-fetch';
import { useNavigate } from '@tanstack/react-router';

import LifecycleSidebar from '../../../../src/components/lifecycle/LifecycleSidebar';
import {
	ARCHIVED,
	TRASH,
} from '../../../../src/components/lifecycle/lifecycleStates';

let mockTrashState;
const navigate = jest.fn();
const dispatch = {
	createErrorNotice: jest.fn(),
	createSuccessNotice: jest.fn(),
	invalidateResolution: jest.fn(),
	receiveEntityRecords: jest.fn(),
	saveEntityRecord: jest.fn(),
};

const CURRENT_USER_ID = 1;

function page( id, title, overrides = {} ) {
	const { meta, ...rest } = overrides;
	return {
		id,
		title,
		path: `page-${ id }`,
		parent: 0,
		crtxt_trait: [],
		cortext_defines_trait: false,
		trashed_at: '2026-11-18T10:00:00+00:00',
		purge_at: new Date( Date.now() + 29.5 * 86400000 ).toISOString(),
		trashed_by: { id: CURRENT_USER_ID, name: 'admin' },
		meta: {
			cortext_document_icon: '',
			_cortext_trashed_by_parent: 0,
			_cortext_trashed_by_collection: 0,
			...meta,
		},
		...rest,
	};
}

function row( id, title, collection ) {
	return page( id, title, {
		crtxt_trait: [ collection.id ],
		collection,
	} );
}

function setTrash( documents ) {
	mockTrashState = {
		documents,
		total: documents.length,
		isLoading: false,
		hasResolved: true,
		error: null,
		refresh: jest.fn(),
	};
}

const onBack = jest.fn();

function renderView( state, selectedId = null ) {
	return render(
		<LifecycleSidebar
			state={ state }
			collapsed={ false }
			onBack={ onBack }
			documentsState={ mockTrashState }
			selectedId={ selectedId }
		/>
	);
}

function renderTrash( selectedId = null ) {
	return renderView( TRASH, selectedId );
}

function archivedPage( id, title, overrides = {} ) {
	const { meta, ...rest } = overrides;
	return page( id, title, {
		trashed_at: undefined,
		purge_at: undefined,
		trashed_by: undefined,
		archived_at: '2026-11-18T10:00:00+00:00',
		archived_by: { id: CURRENT_USER_ID, name: 'admin' },
		meta: {
			_cortext_archived_by_parent: 0,
			_cortext_archived_by_collection: 0,
			...meta,
		},
		...rest,
	} );
}

function option( title ) {
	return screen
		.getAllByRole( 'option' )
		.find( ( node ) => node.textContent.includes( title ) );
}

beforeEach( () => {
	jest.clearAllMocks();
	useDispatch.mockReturnValue( dispatch );
	useNavigate.mockReturnValue( navigate );
	useSelect.mockImplementation( ( callback ) =>
		callback( () => ( {
			getCurrentUser: () => ( { id: CURRENT_USER_ID } ),
		} ) )
	);
	useEntityRecords.mockReturnValue( {
		records: [ { id: 50, parent: 0, title: { raw: 'Library' } } ],
	} );
	setTrash( [] );
} );

describe( 'LifecycleSidebar as Trash', () => {
	it( 'goes back when asked', () => {
		renderTrash();
		fireEvent.click( screen.getByRole( 'button', { name: 'Back' } ) );
		expect( onBack ).toHaveBeenCalled();
	} );

	it( 'says when Trash is empty', () => {
		renderTrash();
		expect( screen.getByText( 'Trash is empty.' ) ).toBeInTheDocument();
		expect(
			screen.queryByLabelText( 'Search Trash' )
		).not.toBeInTheDocument();
	} );

	it( 'lists cascade roots only, with how many documents come back with each', () => {
		setTrash( [
			page( 1, 'Reading notes', { parent: 50 } ),
			page( 2, 'Q1 highlights', {
				parent: 1,
				meta: { _cortext_trashed_by_parent: 1 },
			} ),
			page( 3, 'Margin notes', {
				parent: 1,
				meta: { _cortext_trashed_by_parent: 1 },
			} ),
			page( 4, 'Old draft' ),
		] );
		renderTrash( 1 );

		expect( screen.getAllByRole( 'option' ) ).toHaveLength( 2 );
		expect( option( 'Reading notes' ) ).toHaveTextContent( '+2' );
		expect( option( 'Reading notes' ) ).toHaveTextContent( 'Library' );
	} );

	it( 'selects the first item by replacing the URL when none is selected', () => {
		setTrash( [ page( 1, 'Notes' ), page( 2, 'Ideas' ) ] );
		renderTrash();

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'trash/1' },
			replace: true,
		} );
	} );

	it( 'marks the item selected in the URL', () => {
		setTrash( [ page( 1, 'Notes' ), page( 2, 'Ideas' ) ] );
		renderTrash( 2 );

		expect( option( 'Ideas' ) ).toHaveAttribute( 'aria-selected', 'true' );
		expect( navigate ).not.toHaveBeenCalled();
	} );

	it( 'names who deleted an item only when it was someone else', () => {
		setTrash( [
			page( 1, 'Mine' ),
			page( 2, 'Theirs', { trashed_by: { id: 7, name: 'maria' } } ),
		] );
		renderTrash( 1 );

		expect( option( 'Theirs' ) ).toHaveTextContent( 'maria · 2 hours ago' );
		expect( option( 'Mine' ) ).not.toHaveTextContent( 'admin' );
	} );

	it( 'finds a root through a nested document that matches the search', () => {
		setTrash( [
			page( 1, 'Reading notes' ),
			page( 2, 'Quotes to keep', {
				parent: 1,
				meta: { _cortext_trashed_by_parent: 1 },
			} ),
			page( 3, 'Old draft' ),
		] );
		renderTrash( 1 );

		fireEvent.change( screen.getByLabelText( 'Search Trash' ), {
			target: { value: 'quotes' },
		} );

		expect( screen.getAllByRole( 'option' ) ).toHaveLength( 1 );
		expect( option( 'Reading notes' ) ).toHaveTextContent(
			'Contains “Quotes to keep”'
		);
	} );

	it( 'filters by type', () => {
		const books = { id: 12, title: 'Books', path: 'collection/books-12' };
		setTrash( [ page( 1, 'Notes' ), row( 2, 'Beloved', books ) ] );
		renderTrash( 1 );

		fireEvent.click( screen.getByRole( 'button', { name: 'Rows' } ) );

		expect( screen.getAllByRole( 'option' ) ).toHaveLength( 1 );
		expect( option( 'Beloved' ) ).toHaveTextContent( 'Books' );
	} );

	it( 'moves with the arrows, restores with Enter and asks before deleting with Backspace', async () => {
		setTrash( [ page( 1, 'Notes' ), page( 2, 'Ideas' ) ] );
		apiFetch.mockResolvedValue( {
			restored: [ 1 ],
			post: { id: 1, status: 'private' },
		} );
		renderTrash( 1 );
		const listbox = screen.getByRole( 'listbox' );

		fireEvent.keyDown( listbox, { key: 'ArrowDown' } );
		expect( navigate ).toHaveBeenLastCalledWith( {
			to: '/$',
			params: { _splat: 'trash/2' },
			replace: true,
		} );

		await act( async () => {
			fireEvent.keyDown( listbox, { key: 'Enter' } );
		} );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/1/restore',
			method: 'POST',
		} );

		fireEvent.keyDown( listbox, { key: 'Backspace' } );
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent(
			'Delete this document permanently?'
		);
		apiFetch.mockResolvedValue( { deleted: [ 1 ] } );
		await act( async () => {
			fireEvent.click( screen.getByTestId( 'confirm-dialog-confirm' ) );
		} );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/cortext/v1/documents/1/permanent-delete',
			method: 'POST',
		} );
	} );

	it( 'shows how many items there are and empties Trash after confirming', async () => {
		setTrash( [ page( 1, 'Notes' ), page( 2, 'Ideas' ) ] );
		apiFetch.mockResolvedValue( { deleted: [ 1, 2 ] } );
		renderTrash( 1 );

		expect(
			screen.getByRole( 'heading', { name: 'Trash 2' } )
		).toBeInTheDocument();
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Empty Trash…' } )
		);
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent(
			'Delete all 2 items in Trash permanently?'
		);
		await act( async () => {
			fireEvent.click( screen.getByTestId( 'confirm-dialog-confirm' ) );
		} );

		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/empty-trash',
			method: 'POST',
		} );
		expect( dispatch.createSuccessNotice ).toHaveBeenCalledWith(
			'2 documents deleted permanently.',
			{ id: 'cortext-trash-emptied', type: 'snackbar' }
		);
	} );

	it( 'drops the selection from the URL once Trash is empty', () => {
		renderTrash( 7 );

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'trash' },
			replace: true,
		} );
	} );

	it( 'keeps the selection in the URL while Trash is still loading', () => {
		mockTrashState = {
			documents: [],
			total: 0,
			isLoading: false,
			hasResolved: false,
			error: null,
			refresh: jest.fn(),
		};
		renderTrash( 7 );

		expect( navigate ).not.toHaveBeenCalled();
	} );
} );

describe( 'LifecycleSidebar as Archived', () => {
	it( 'says when nothing is archived', () => {
		renderView( ARCHIVED );
		expect(
			screen.getByText( 'No archived documents.' )
		).toBeInTheDocument();
	} );

	it( 'shows how many items there are, with no way to empty the view', () => {
		setTrash( [ archivedPage( 1, 'Notes' ), archivedPage( 2, 'Ideas' ) ] );
		renderView( ARCHIVED, 1 );

		expect(
			screen.getByRole( 'heading', { name: 'Archived 2' } )
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'button', { name: 'Empty Trash…' } )
		).not.toBeInTheDocument();
		expect(
			screen.getByLabelText( 'Search Archived' )
		).toBeInTheDocument();
	} );

	it( 'lists cascade roots only, with where each one hung from', () => {
		setTrash( [
			archivedPage( 1, 'Reading notes', { parent: 50 } ),
			archivedPage( 2, 'Q1 highlights', {
				parent: 1,
				meta: { _cortext_archived_by_parent: 1 },
			} ),
			archivedPage( 3, 'Old draft' ),
		] );
		renderView( ARCHIVED, 1 );

		expect( screen.getAllByRole( 'option' ) ).toHaveLength( 2 );
		expect( option( 'Reading notes' ) ).toHaveTextContent( '+1' );
		expect( option( 'Reading notes' ) ).toHaveTextContent( 'Library' );
	} );

	it( 'selects the first item at its archived URL', () => {
		setTrash( [ archivedPage( 1, 'Notes' ) ] );
		renderView( ARCHIVED );

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'archived/1' },
			replace: true,
		} );
	} );

	it( 'names who archived an item only when it was someone else', () => {
		setTrash( [
			archivedPage( 1, 'Mine' ),
			archivedPage( 2, 'Theirs', {
				archived_by: { id: 7, name: 'maria' },
			} ),
		] );
		renderView( ARCHIVED, 1 );

		expect( option( 'Theirs' ) ).toHaveTextContent( 'maria · 2 hours ago' );
		expect( option( 'Mine' ) ).not.toHaveTextContent( 'admin' );
	} );

	it( 'unarchives with Enter and moves to Trash with Backspace after confirming', async () => {
		setTrash( [ archivedPage( 1, 'Notes' ), archivedPage( 2, 'Ideas' ) ] );
		apiFetch.mockResolvedValue( {
			restored: [ 1 ],
			post: { id: 1, status: 'draft' },
		} );
		renderView( ARCHIVED, 1 );
		const listbox = screen.getByRole( 'listbox' );

		await act( async () => {
			fireEvent.keyDown( listbox, { key: 'Enter' } );
		} );
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/1/unarchive',
			method: 'POST',
		} );

		fireEvent.keyDown( listbox, { key: 'Backspace' } );
		expect( screen.getByRole( 'dialog' ) ).toHaveTextContent( '30 days' );
		apiFetch.mockResolvedValue( { cascade_deleted: [] } );
		await act( async () => {
			fireEvent.click( screen.getByTestId( 'confirm-dialog-confirm' ) );
		} );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/wp/v2/crtxt_documents/1',
			method: 'DELETE',
		} );
	} );

	it( 'drops the selection from the URL once nothing is archived', () => {
		renderView( ARCHIVED, 7 );

		expect( navigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'archived' },
			replace: true,
		} );
	} );
} );
