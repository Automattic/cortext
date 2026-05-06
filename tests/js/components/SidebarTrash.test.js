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
		icon, // eslint-disable-line no-unused-vars
		isDestructive, // eslint-disable-line no-unused-vars
		variant, // eslint-disable-line no-unused-vars
		size, // eslint-disable-line no-unused-vars
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

import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import apiFetch from '@wordpress/api-fetch';

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

beforeEach( () => {
	useEntityRecords.mockReset();
	useDispatch.mockReset();
	apiFetch.mockReset();
	dispatchMocks.deleteEntityRecord.mockReset();
	dispatchMocks.invalidateResolution.mockReset();
	useDispatch.mockReturnValue( dispatchMocks );
} );

function setTrashRecords( { records = [], status = 'SUCCESS', hasResolved = true } = {} ) {
	useEntityRecords.mockReturnValue( {
		records,
		status,
		hasResolved,
	} );
}

function clickConfirm() {
	fireEvent.click( screen.getByTestId( 'confirm-dialog-confirm' ) );
}

function makePage( overrides = {} ) {
	const { meta, ...rest } = overrides;
	return {
		id: 1,
		title: { rendered: 'A page', raw: 'A page' },
		parent: 0,
		meta: { _cortext_trashed_by_parent: 0, ...( meta ?? {} ) },
		...rest,
	};
}

describe( 'SidebarTrash', () => {
	it( 'shows a spinner while the trash query resolves', () => {
		setTrashRecords( {
			records: undefined,
			hasResolved: false,
			status: 'RESOLVING',
		} );

		const { container } = render( <SidebarTrash activePages={ [] } /> );

		expect( container.querySelector( '.cortext-sidebar__loading' ) ).toBeTruthy();
		expect(
			container.querySelector( '.cortext-sidebar__empty' )
		).toBeFalsy();
	} );

	it( 'shows the empty state when the trash is empty', () => {
		setTrashRecords( { records: [] } );

		render( <SidebarTrash activePages={ [] } /> );

		expect( screen.getByText( 'No trashed pages.' ) ).toBeInTheDocument();
	} );

	it( 'keeps the last resolved trash list visible during a background refetch', () => {
		const page = makePage( {
			id: 7,
			title: { rendered: 'Cached doc', raw: 'Cached doc' },
		} );
		setTrashRecords( { records: [ page ] } );
		const { rerender } = render( <SidebarTrash activePages={ [] } /> );

		expect( screen.getByText( 'Cached doc' ) ).toBeInTheDocument();

		setTrashRecords( {
			records: undefined,
			hasResolved: false,
			status: 'RESOLVING',
		} );
		rerender( <SidebarTrash activePages={ [] } /> );

		expect( screen.queryByTestId( 'spinner' ) ).not.toBeInTheDocument();
		expect( screen.getByText( 'Cached doc' ) ).toBeInTheDocument();
	} );

	it( 'shows an error state with a Retry button when the fetch failed', () => {
		setTrashRecords( { records: undefined, status: 'ERROR' } );

		render( <SidebarTrash activePages={ [] } /> );

		expect(
			screen.getByText( 'Could not load trashed pages.' )
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

		const { container } = render(
			<SidebarTrash activePages={ [ grandparent, parent ] } />
		);

		expect( screen.getByText( 'Notes' ) ).toBeInTheDocument();
		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toHaveTextContent( 'Workspace / Project' );
	} );

	it( 'falls back to no breadcrumb when ancestors are missing (orphan)', () => {
		const orphan = makePage( { id: 5, parent: 99 } );

		setTrashRecords( { records: [ orphan ] } );

		const { container } = render(
			<SidebarTrash activePages={ [] } />
		);

		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toBeFalsy();
	} );

	it( 'POSTs to /cortext/v1/pages/<id>/restore and refreshes both page queries', async () => {
		setTrashRecords( {
			records: [ makePage( { id: 7, title: { rendered: 'Doc', raw: 'Doc' } } ) ],
		} );
		apiFetch.mockResolvedValue( { restored: [ 7 ] } );

		render( <SidebarTrash activePages={ [] } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Restore' } )
		);

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/pages/7/restore',
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

	it( 'surfaces a row-level error when restore fails and leaves the row in trash', async () => {
		setTrashRecords( {
			records: [ makePage( { id: 8 } ) ],
		} );
		apiFetch.mockRejectedValue( { message: 'Server exploded' } );

		render( <SidebarTrash activePages={ [] } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Restore' } )
		);

		await waitFor( () => {
			expect( screen.getByText( 'Server exploded' ) ).toBeInTheDocument();
		} );

		expect( dispatchMocks.invalidateResolution ).not.toHaveBeenCalled();
	} );

	it( 'POSTs to /cortext/v1/pages/<id>/permanent-delete after confirmation', async () => {
		setTrashRecords( {
			records: [ makePage( { id: 9 } ) ],
		} );
		apiFetch.mockResolvedValue( { deleted: [ 9 ] } );

		render( <SidebarTrash activePages={ [] } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		clickConfirm();

		await waitFor( () => {
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/pages/9/permanent-delete',
				method: 'POST',
			} );
		} );

		expect( dispatchMocks.invalidateResolution ).toHaveBeenCalledWith(
			'getEntityRecords',
			[ 'postType', POST_TYPE, TRASHED_PAGES_QUERY ]
		);
	} );

	it( 'navigates the canvas away when the open page is permanent-deleted (root or descendant)', async () => {
		const onSelect = jest.fn();
		setTrashRecords( { records: [ makePage( { id: 1 } ) ] } );
		// Server-side cascade also deletes id 5 (a tagged descendant); the
		// response lists every id that's gone now.
		apiFetch.mockResolvedValue( { deleted: [ 1, 5 ] } );

		render(
			<SidebarTrash
				activePages={ [] }
				selectedId={ 5 }
				onSelect={ onSelect }
			/>
		);

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);
		clickConfirm();

		await waitFor( () => {
			expect( onSelect ).toHaveBeenCalledWith( null );
		} );
	} );

	it( 'leaves the canvas alone when permanent-delete does not include the open page', async () => {
		const onSelect = jest.fn();
		setTrashRecords( { records: [ makePage( { id: 1 } ) ] } );
		apiFetch.mockResolvedValue( { deleted: [ 1 ] } );

		render(
			<SidebarTrash
				activePages={ [] }
				selectedId={ 99 }
				onSelect={ onSelect }
			/>
		);

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

		render( <SidebarTrash activePages={ [] } /> );

		expect( screen.getByText( 'Workspace' ) ).toBeInTheDocument();
		expect( screen.queryByText( 'Engineering' ) ).not.toBeInTheDocument();
		expect( screen.queryByText( 'PHP' ) ).not.toBeInTheDocument();
	} );

	it( 'shows the cascade subtree count beside the root', () => {
		const root = makePage( { id: 1, title: { rendered: 'Workspace', raw: 'Workspace' } } );
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

		const { container } = render( <SidebarTrash activePages={ [] } /> );

		expect(
			container.querySelector( '.cortext-sidebar__breadcrumb' )
		).toHaveTextContent( '2 subpages' );
	} );

	it( 'promotes orphaned descendants (stale marker) back to roots', () => {
		// Marker points at a parent that's no longer in trash (it was
		// permanently deleted before this PR's cascade was wired in, or by
		// some other path). The orphan should still appear in the list.
		const orphan = makePage( {
			id: 7,
			title: { rendered: 'Stranded', raw: 'Stranded' },
			parent: 99,
			meta: { _cortext_trashed_by_parent: 99 },
		} );

		setTrashRecords( { records: [ orphan ] } );

		render( <SidebarTrash activePages={ [] } /> );

		expect( screen.getByText( 'Stranded' ) ).toBeInTheDocument();
	} );

	it( 'calls onSelect when a trashed row title is clicked', () => {
		const onSelect = jest.fn();
		const root = makePage( {
			id: 42,
			title: { rendered: 'Stranded', raw: 'Stranded' },
		} );

		setTrashRecords( { records: [ root ] } );

		render(
			<SidebarTrash
				activePages={ [] }
				selectedId={ null }
				onSelect={ onSelect }
			/>
		);

		fireEvent.click( screen.getByText( 'Stranded' ) );

		expect( onSelect ).toHaveBeenCalledWith( 42, expect.objectContaining( { id: 42 } ) );
	} );

	it( 'announces subtree size in the permanent-delete confirmation', () => {
		const root = makePage( { id: 1, title: { rendered: 'Workspace', raw: 'Workspace' } } );
		const child = makePage( {
			id: 2,
			parent: 1,
			meta: { _cortext_trashed_by_parent: 1 },
		} );

		setTrashRecords( { records: [ root, child ] } );

		render( <SidebarTrash activePages={ [] } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Delete permanently' } )
		);

		expect(
			screen.getByText(
				'Permanently delete this page and 1 subpage? This cannot be undone.'
			)
		).toBeInTheDocument();
	} );
} );
