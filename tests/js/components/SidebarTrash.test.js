/**
 * Render and behavior tests for `src/components/SidebarTrash.js`.
 *
 * Mocks `@wordpress/core-data`, `@wordpress/data`, and `@wordpress/api-fetch`
 * so each case can drive the trash query state, capture dispatched actions,
 * and assert the REST calls SidebarTrash makes.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Stub @wordpress/components so the test does not transitively pull in
// rich-text → block-editor → parsel-js (an ESM-only package the jest CJS
// transformer chokes on).
jest.mock( '@wordpress/components', () => {
	const ReactLib = require( 'react' );
	const Button = ( {
		children,
		onClick,
		label,
		disabled,
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
				...rest,
			},
			children ?? label
		);
	const Spinner = () =>
		ReactLib.createElement( 'div', { 'data-testid': 'spinner' } );
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
	return {
		__esModule: true,
		Button,
		Spinner,
		__experimentalConfirmDialog: ConfirmDialog,
	};
} );

jest.mock( '@wordpress/icons', () => ( {
	__esModule: true,
	rotateLeft: 'rotate-left-icon',
	trash: 'trash-icon',
	page: 'page-icon',
	Icon: ( { icon } ) => <span data-testid={ `icon-${ icon }` } />,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityRecord: jest.fn().mockReturnValue( { record: null } ),
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: jest.fn(),
} ) );

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '@tanstack/react-router', () => ( {
	__esModule: true,
	useNavigate: jest.fn(),
} ) );

jest.mock( '../../../src/components/TypeToConfirmDialog', () => {
	const ReactLib = require( 'react' );
	return {
		__esModule: true,
		default: ( {
			title,
			message,
			confirmPhrase,
			confirmLabel,
			onConfirm,
			onCancel,
		} ) =>
			ReactLib.createElement(
				'div',
				{ role: 'dialog', 'data-testid': 'type-to-confirm' },
				ReactLib.createElement( 'p', null, title ),
				ReactLib.createElement( 'p', null, message ),
				ReactLib.createElement(
					'span',
					{ 'data-testid': 'type-to-confirm-phrase' },
					confirmPhrase
				),
				ReactLib.createElement(
					'button',
					{
						onClick: onConfirm,
						'data-testid': 'type-to-confirm-confirm',
					},
					confirmLabel
				),
				ReactLib.createElement(
					'button',
					{ onClick: onCancel },
					'Cancel'
				)
			),
	};
} );

import { useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';
import { useNavigate } from '@tanstack/react-router';

import SidebarTrash from '../../../src/components/SidebarTrash';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from '../../../src/components/page-queries';

const dispatchMocks = {
	deleteEntityRecord: jest.fn(),
	invalidateResolution: jest.fn(),
};

const navigateMock = jest.fn();

beforeEach( () => {
	useDispatch.mockReset();
	apiFetch.mockReset();
	useNavigate.mockReset();
	dispatchMocks.deleteEntityRecord.mockReset();
	dispatchMocks.invalidateResolution.mockReset();
	navigateMock.mockReset();
	useDispatch.mockReturnValue( dispatchMocks );
	useNavigate.mockReturnValue( navigateMock );
	trashState = makeDocumentsState();
} );

let trashState;

function setTrashRecords( {
	records = [],
	status = 'SUCCESS',
	hasResolved = true,
} = {} ) {
	trashState = makeDocumentsState( {
		documents: records ?? [],
		isLoading: status === 'RESOLVING',
		hasResolved,
		error: status === 'ERROR' ? new Error( 'Could not fetch' ) : null,
	} );
}

function renderSidebarTrash( props = {} ) {
	return render(
		<SidebarTrash
			activePages={ [] }
			trashedDocumentsState={ trashState }
			{ ...props }
		/>
	);
}

function clickConfirm() {
	fireEvent.click( screen.getByTestId( 'confirm-dialog-confirm' ) );
}

function makePage( overrides = {} ) {
	const { meta, ...rest } = overrides;
	return {
		id: 1,
		type: POST_TYPE,
		kind: 'page',
		title: { rendered: 'A page', raw: 'A page' },
		parent: 0,
		meta: { _cortext_trashed_by_parent: 0, ...( meta ?? {} ) },
		...rest,
	};
}

function makeRow( overrides = {} ) {
	const { meta, collection, ...rest } = overrides;
	return {
		id: 101,
		type: 'crtxt_books',
		kind: 'row',
		slug: 'archived-book',
		status: 'trash',
		title: { rendered: 'Archived book', raw: 'Archived book' },
		meta: { cortext_document_icon: '', ...( meta ?? {} ) },
		collection: {
			id: 12,
			slug: 'books',
			title: { rendered: 'Books', raw: 'Books' },
			...( collection ?? {} ),
		},
		...rest,
	};
}

function makeCollection( overrides = {} ) {
	const { meta, owner, ...rest } = overrides;
	return {
		id: 201,
		type: 'crtxt_collection',
		kind: 'collection',
		title: { rendered: 'Tasks', raw: 'Tasks' },
		parent: 0,
		meta: {
			cortext_document_icon: '',
			_cortext_trashed_by_parent: 0,
			_cortext_trashed_by_owner_page: 0,
			...( meta ?? {} ),
		},
		...( owner !== undefined ? { owner } : {} ),
		...rest,
	};
}

function makeDocumentsState( overrides = {} ) {
	return {
		documents: [],
		total: 0,
		isLoading: false,
		hasResolved: true,
		error: null,
		refresh: jest.fn(),
		...overrides,
	};
}

describe( 'SidebarTrash', () => {
	it( 'shows a spinner while the trash query resolves', () => {
		setTrashRecords( {
			records: undefined,
			hasResolved: false,
			status: 'RESOLVING',
		} );

		const { container } = renderSidebarTrash();

		expect(
			container.querySelector( '.cortext-sidebar__loading' )
		).toBeTruthy();
		expect(
			container.querySelector( '.cortext-sidebar__empty' )
		).toBeFalsy();
	} );

	it( 'shows the empty state when the trash is empty', () => {
		setTrashRecords( { records: [] } );

		renderSidebarTrash();

		expect( screen.getByText( 'Trash is empty.' ) ).toBeInTheDocument();
	} );

	it( 'keeps the last resolved trash list visible during a background refetch', () => {
		const page = makePage( {
			id: 7,
			title: { rendered: 'Cached doc', raw: 'Cached doc' },
		} );
		setTrashRecords( { records: [ page ] } );
		const { rerender } = renderSidebarTrash();

		expect( screen.getByText( 'Cached doc' ) ).toBeInTheDocument();

		setTrashRecords( {
			records: undefined,
			hasResolved: false,
			status: 'RESOLVING',
		} );
		rerender(
			<SidebarTrash
				activePages={ [] }
				trashedDocumentsState={ trashState }
			/>
		);

		expect( screen.queryByTestId( 'spinner' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Cached doc' ) ).toBeInTheDocument();
	} );

	it( 'shows an error state with a Retry button when the fetch failed', () => {
		setTrashRecords( { records: undefined, status: 'ERROR' } );

		renderSidebarTrash();

		expect(
			screen.getByText( 'Could not load Trash.' )
		).toBeInTheDocument();

		fireEvent.click( screen.getByRole( 'button', { name: 'Retry' } ) );

		expect( dispatchMocks.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', POST_TYPE, TRASHED_PAGES_QUERY ]
		);
	} );

	it( 'renders each trashed page with a breadcrumb of ancestor titles', () => {
		const grandparent = makePage( {
			id: 10,
			title: { rendered: 'Workspace', raw: 'Workspace' },
		} );
		const parent = makePage( {
			id: 11,
			parent: 10,
			title: { rendered: 'Project', raw: 'Project' },
		} );
		const child = makePage( {
			id: 12,
			parent: 11,
			title: { rendered: 'Notes', raw: 'Notes' },
		} );

		setTrashRecords( { records: [ child ] } );

		const { container } = renderSidebarTrash( {
			activePages: [ grandparent, parent ],
		} );

		expect( screen.getByText( 'Notes' ) ).toBeInTheDocument();
		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toHaveTextContent( 'Workspace / Project' );
	} );

	it( 'falls back to no breadcrumb when ancestors are missing (orphan)', () => {
		const orphan = makePage( { id: 5, parent: 99 } );

		setTrashRecords( { records: [ orphan ] } );

		const { container } = renderSidebarTrash();

		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toBeFalsy();
	} );

	it( 'POSTs to /cortext/v1/documents/<id>/restore and refreshes both page queries', async () => {
		setTrashRecords( {
			records: [
				makePage( { id: 7, title: { rendered: 'Doc', raw: 'Doc' } } ),
			],
		} );
		apiFetch.mockResolvedValue( { restored: [ 7 ] } );

		renderSidebarTrash();

		fireEvent.click( screen.getByRole( 'button', { name: 'Restore' } ) );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/documents/7/restore',
				method: 'POST',
			} );
		} );

		expect( dispatchMocks.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', POST_TYPE, ACTIVE_PAGES_QUERY ]
		);
		expect( dispatchMocks.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', POST_TYPE, TRASHED_PAGES_QUERY ]
		);
	} );

	it( 'renders trashed rows with collection context', () => {
		const row = makeRow( {
			id: 17,
			title: { rendered: 'Draft record', raw: 'Draft record' },
			collection: {
				id: 22,
				title: { rendered: 'Research', raw: 'Research' },
			},
		} );
		setTrashRecords( { records: [ row ] } );

		renderSidebarTrash();

		expect( screen.getByText( 'Draft record' ) ).toBeInTheDocument();
		expect( screen.getByText( 'Research' ) ).toBeInTheDocument();
	} );

	it( 'restores a row through the document endpoint', async () => {
		const refresh = jest.fn();
		setTrashRecords( { records: [ makeRow( { id: 17 } ) ] } );
		trashState.refresh = refresh;
		apiFetch.mockResolvedValue( { restored: [ 17 ] } );

		renderSidebarTrash();

		fireEvent.click( screen.getByRole( 'button', { name: 'Restore' } ) );

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/documents/17/restore',
				method: 'POST',
			} );
		} );
		expect( refresh ).toHaveBeenCalled();
		expect( dispatchMocks.invalidateResolution ).not.toHaveBeenCalled();
	} );

	it( 'shows restore errors next to the item', async () => {
		setTrashRecords( {
			records: [ makePage( { id: 8 } ) ],
		} );
		apiFetch.mockRejectedValue( { message: 'Server exploded' } );

		renderSidebarTrash();

		fireEvent.click( screen.getByRole( 'button', { name: 'Restore' } ) );

		await waitFor( () => {
			expect( screen.getByText( 'Server exploded' ) ).toBeInTheDocument();
		} );

		expect( dispatchMocks.invalidateResolution ).not.toHaveBeenCalled();
	} );

	it( 'POSTs to /cortext/v1/documents/<id>/permanent-delete after confirmation', async () => {
		setTrashRecords( {
			records: [ makePage( { id: 9 } ) ],
		} );
		apiFetch.mockResolvedValue( { deleted: [ 9 ] } );

		renderSidebarTrash();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		clickConfirm();

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/documents/9/permanent-delete',
				method: 'POST',
			} );
		} );

		expect( dispatchMocks.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', POST_TYPE, TRASHED_PAGES_QUERY ]
		);
	} );

	it( 'permanently deletes a selected row through the document endpoint', async () => {
		const onSelect = jest.fn();
		const refresh = jest.fn();
		setTrashRecords( { records: [ makeRow( { id: 17 } ) ] } );
		trashState.refresh = refresh;
		apiFetch.mockResolvedValue( { deleted: [ 17 ] } );

		renderSidebarTrash( { selectedId: 17, onSelect } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		clickConfirm();

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/documents/17/permanent-delete',
				method: 'POST',
			} );
		} );
		expect( refresh ).toHaveBeenCalled();
		expect( onSelect ).toHaveBeenCalledWith( null );
	} );

	it( 'navigates the canvas away when the open page is permanent-deleted (root or descendant)', async () => {
		const onSelect = jest.fn();
		setTrashRecords( { records: [ makePage( { id: 1 } ) ] } );
		// Server-side cascade also deletes id 5 (a tagged descendant); the
		// response lists every id that's gone now.
		apiFetch.mockResolvedValue( { deleted: [ 1, 5 ] } );

		renderSidebarTrash( { selectedId: 5, onSelect } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		clickConfirm();

		await waitFor( () => {
			expect( onSelect ).toHaveBeenCalledWith( null );
		} );
	} );

	it( 'navigates the canvas away when the open collection is permanent-deleted', async () => {
		// Collection routes live in selectedCollectionId, not selectedId.
		// Without checking both, the canvas would keep pointing at a deleted
		// collection URL after the row clicks Delete permanently.
		const onSelect = jest.fn();
		setTrashRecords( {
			records: [
				makeCollection( {
					id: 73,
					path: 'collection/library-73',
				} ),
			],
		} );
		apiFetch.mockResolvedValue( { deleted: [ 73 ] } );

		renderSidebarTrash( {
			selectedId: null,
			selectedCollectionId: 73,
			onSelect,
		} );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		fireEvent.click( screen.getByTestId( 'type-to-confirm-confirm' ) );

		await waitFor( () => {
			expect( onSelect ).toHaveBeenCalledWith( null );
		} );
	} );

	it( 'leaves the canvas alone when permanent-delete does not include the open page', async () => {
		const onSelect = jest.fn();
		setTrashRecords( { records: [ makePage( { id: 1 } ) ] } );
		apiFetch.mockResolvedValue( { deleted: [ 1 ] } );

		renderSidebarTrash( { selectedId: 99, onSelect } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		clickConfirm();

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalled();
		} );
		expect( onSelect ).not.toHaveBeenCalled();
	} );

	it( 'hides cascade descendants and lists only roots', () => {
		const root = makePage( {
			id: 1,
			title: { rendered: 'Workspace', raw: 'Workspace' },
		} );
		const child = makePage( {
			id: 2,
			parent: 1,
			title: { rendered: 'Engineering', raw: 'Engineering' },
			meta: { _cortext_trashed_by_parent: 1 },
		} );
		const grandchild = makePage( {
			id: 3,
			parent: 2,
			title: { rendered: 'PHP', raw: 'PHP' },
			meta: { _cortext_trashed_by_parent: 2 },
		} );

		setTrashRecords( { records: [ root, child, grandchild ] } );

		renderSidebarTrash();

		expect( screen.getByText( 'Workspace' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Engineering' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'PHP' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the cascade subtree count beside the root', () => {
		const root = makePage( {
			id: 1,
			title: { rendered: 'Workspace', raw: 'Workspace' },
		} );
		const child = makePage( {
			id: 2,
			parent: 1,
			meta: { _cortext_trashed_by_parent: 1 },
		} );
		const grandchild = makePage( {
			id: 3,
			parent: 2,
			meta: { _cortext_trashed_by_parent: 2 },
		} );

		setTrashRecords( { records: [ root, child, grandchild ] } );

		const { container } = renderSidebarTrash();

		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toHaveTextContent( '2 subpages' );
	} );

	it( 'shows a collection count when a trashed page owns only inline collections', () => {
		const root = makePage( {
			id: 1,
			title: { rendered: 'Quarterly review', raw: 'Quarterly review' },
		} );
		const inline = makeCollection( {
			id: 2,
			title: { rendered: 'Action items', raw: 'Action items' },
			meta: { _cortext_trashed_by_owner_page: 1 },
		} );

		setTrashRecords( { records: [ root, inline ] } );

		const { container } = renderSidebarTrash();

		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toHaveTextContent( '1 collection' );
	} );

	it( 'falls back to nested items when a trashed page mixes subpages and inline collections', () => {
		const root = makePage( {
			id: 1,
			title: { rendered: 'Quarterly review', raw: 'Quarterly review' },
		} );
		const subpage = makePage( {
			id: 2,
			parent: 1,
			meta: { _cortext_trashed_by_parent: 1 },
		} );
		const inline = makeCollection( {
			id: 3,
			meta: { _cortext_trashed_by_owner_page: 1 },
		} );

		setTrashRecords( { records: [ root, subpage, inline ] } );

		const { container } = renderSidebarTrash();

		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toHaveTextContent( '2 nested items' );
	} );

	it( 'promotes orphaned descendants (stale marker) back to roots', () => {
		// Marker points at a parent no longer in Trash. It may have been
		// permanently deleted by an older build or a different path; either
		// way, the orphan still needs to be reachable.
		const orphan = makePage( {
			id: 7,
			title: { rendered: 'Stranded', raw: 'Stranded' },
			parent: 99,
			meta: { _cortext_trashed_by_parent: 99 },
		} );

		setTrashRecords( { records: [ orphan ] } );

		renderSidebarTrash();

		expect( screen.getByText( 'Stranded' ) ).toBeInTheDocument();
	} );

	it( 'navigates to the document path when a trashed page title is clicked', () => {
		const root = makePage( {
			id: 42,
			title: { rendered: 'Stranded', raw: 'Stranded' },
			path: 'page/stranded-42',
		} );

		setTrashRecords( { records: [ root ] } );

		renderSidebarTrash( { selectedId: null } );

		fireEvent.click( screen.getByText( 'Stranded' ) );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'page/stranded-42' },
		} );
	} );

	it( 'navigates with the collection/ prefix when a trashed collection title is clicked', () => {
		// Documents controller hands back the right path per kind. Without
		// honoring it, the click would navigate to a bare id and mount the
		// document Canvas instead of the CollectionPane.
		const collection = makeCollection( {
			id: 73,
			title: { rendered: 'Library', raw: 'Library' },
			path: 'collection/library-73',
		} );

		setTrashRecords( { records: [ collection ] } );

		renderSidebarTrash();

		fireEvent.click( screen.getByText( 'Library' ) );

		expect( navigateMock ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'collection/library-73' },
		} );
	} );

	it( 'renders a trashed full-page collection with no owner breadcrumb', () => {
		const collection = makeCollection( {
			id: 33,
			title: { rendered: 'Roadmap', raw: 'Roadmap' },
		} );

		setTrashRecords( { records: [ collection ] } );

		const { container } = renderSidebarTrash();

		expect( screen.getByText( 'Roadmap' ) ).toBeInTheDocument();
		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toBeFalsy();
	} );

	it( 'renders a trashed inline collection with its owner page in the breadcrumb', () => {
		// Inline collection whose owner page is still active. The trash
		// list surfaces the owner so users can tell similar inline tables
		// apart.
		const inline = makeCollection( {
			id: 34,
			title: { rendered: 'Action items', raw: 'Action items' },
			owner: {
				id: 99,
				title: {
					rendered: 'Quarterly review',
					raw: 'Quarterly review',
				},
				path: 'page/quarterly-99',
			},
		} );

		setTrashRecords( { records: [ inline ] } );

		const { container } = renderSidebarTrash();

		expect( screen.getByText( 'Action items' ) ).toBeInTheDocument();
		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toHaveTextContent( 'Quarterly review' );
	} );

	it( 'nests an inline collection under its owner page when both are in trash', () => {
		// Page → inline collection cascade. The page is the root; the
		// inline collection should fold under it instead of appearing as a
		// second root entry.
		const owner = makePage( {
			id: 50,
			title: { rendered: 'Sprint notes', raw: 'Sprint notes' },
		} );
		const inline = makeCollection( {
			id: 51,
			title: { rendered: 'Action items', raw: 'Action items' },
			meta: { _cortext_trashed_by_owner_page: 50 },
		} );

		setTrashRecords( { records: [ owner, inline ] } );

		renderSidebarTrash();

		expect( screen.getByText( 'Sprint notes' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Action items' ) ).not.toBeInTheDocument();
	} );

	it( 'announces collection rows in the permanent-delete confirmation', () => {
		setTrashRecords( {
			records: [
				makeCollection( {
					id: 60,
					title: { rendered: 'Library', raw: 'Library' },
				} ),
			],
		} );

		renderSidebarTrash();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect(
			screen.getByText(
				"Permanently delete this collection and all its rows? You can't undo this."
			)
		).toBeInTheDocument();
	} );

	it( 'announces subtree size in the permanent-delete confirmation', () => {
		const root = makePage( {
			id: 1,
			title: { rendered: 'Workspace', raw: 'Workspace' },
		} );
		const child = makePage( {
			id: 2,
			parent: 1,
			meta: { _cortext_trashed_by_parent: 1 },
		} );

		setTrashRecords( { records: [ root, child ] } );

		renderSidebarTrash();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect(
			screen.getByText(
				"Permanently delete this page and 1 subpage? You can't undo this."
			)
		).toBeInTheDocument();
	} );

	it( 'uses the typed-name dialog when permanent-deleting a collection', () => {
		// Collections force the user to type the title to confirm. Pages and
		// rows keep the lighter ConfirmDialog because their delete is paired
		// with restore via the same UI path.
		setTrashRecords( {
			records: [
				makeCollection( {
					id: 81,
					title: { rendered: 'Library', raw: 'Library' },
				} ),
			],
		} );

		renderSidebarTrash();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect( screen.getByTestId( 'type-to-confirm' ) ).toBeInTheDocument();
		expect( screen.getByTestId( 'type-to-confirm-phrase' ) ).toHaveTextContent(
			'Library'
		);
	} );

	it( 'uses the plain confirm dialog for pages and rows', () => {
		setTrashRecords( { records: [ makePage( { id: 91 } ) ] } );

		renderSidebarTrash();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect( screen.queryByTestId( 'type-to-confirm' ) ).toBeNull();
		expect( screen.getByTestId( 'confirm-dialog-confirm' ) ).toBeInTheDocument();
	} );

	it( 'falls back to nested items in the confirm when subpages and inline collections mix', () => {
		const root = makePage( {
			id: 1,
			title: { rendered: 'Workspace', raw: 'Workspace' },
		} );
		const subpage = makePage( {
			id: 2,
			parent: 1,
			meta: { _cortext_trashed_by_parent: 1 },
		} );
		const inline = makeCollection( {
			id: 3,
			meta: { _cortext_trashed_by_owner_page: 1 },
		} );

		setTrashRecords( { records: [ root, subpage, inline ] } );

		renderSidebarTrash();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect(
			screen.getByText(
				"Permanently delete this page and 2 nested items? You can't undo this."
			)
		).toBeInTheDocument();
	} );
} );
