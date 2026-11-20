/**
 * E2E coverage for the Archived view in the Cortext shell.
 *
 * Walks the user-visible path the unit tests can't: archive a page from the
 * sidebar, undo it from the snackbar, archive it again, then find it in the
 * Archived view with its nested document and restore it from its banner. An
 * archived collection opens there with its rows, and moves on to Trash after
 * a confirmation.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const PARENT_TITLE = `E2E Archive Parent ${ SUFFIX }`;
const CHILD_TITLE = `E2E Archive Child ${ SUFFIX }`;
const COLLECTION_TITLE = `E2E Archive Books ${ SUFFIX }`;
const ROW_TITLE = `E2E Archive Row ${ SUFFIX }`;

async function deleteIfCreated( requestUtils, path ) {
	if ( ! path ) {
		return;
	}
	try {
		await requestUtils.rest( {
			method: 'DELETE',
			path,
			params: { force: true },
		} );
	} catch {
		// Best-effort cleanup; the test may have already deleted it.
	}
}

async function createArchivedCollection( requestUtils ) {
	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: { title: COLLECTION_TITLE, status: 'private' },
	} );
	const field = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_fields',
		data: { title: 'Author', status: 'private', meta: { type: 'text' } },
	} );
	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/crtxt_documents/${ collection.id }`,
		data: { meta: { cortext_fields: [ String( field.id ) ] } },
	} );
	const row = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			title: ROW_TITLE,
			status: 'private',
			cortext_trait: collection.id,
		},
	} );
	await requestUtils.rest( {
		method: 'POST',
		path: `/cortext/v1/documents/${ collection.id }/archive`,
	} );
	return { collection, field, row };
}

test.describe( 'Archived view', () => {
	test( 'archive from the sidebar, undo, then restore and trash from the Archived view', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let parent;
		let child;
		let fixture;

		try {
			parent = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: { title: PARENT_TITLE, status: 'private' },
			} );
			child = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: CHILD_TITLE,
					status: 'private',
					parent: parent.id,
				},
			} );
			fixture = await createArchivedCollection( requestUtils );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ parent.id }`
			);
			await page.waitForFunction(
				( postId ) =>
					window.wp?.data
						?.select( 'core/editor' )
						?.getCurrentPostId?.() === postId,
				parent.id,
				{ timeout: 15_000 }
			);

			const sidebar = page.locator( '.cortext-sidebar' );
			const parentTitle = sidebar.getByRole( 'button', {
				name: PARENT_TITLE,
				exact: true,
			} );
			const archiveFromSidebar = async () => {
				await parentTitle.hover();
				// `force: true`: the row's drop-zone overlays sit above the
				// ellipsis button even though they let clicks through.
				await sidebar
					.getByRole( 'button', {
						name: `Actions for ${ PARENT_TITLE }`,
						exact: true,
					} )
					.click( { force: true } );
				await page.getByRole( 'menuitem', { name: 'Archive' } ).click();
			};
			const archivedSnackbar = page
				.locator( '.components-snackbar' )
				.filter( {
					hasText: 'Document and 1 nested document archived.',
				} );

			// Archiving drops the page from the tree and says so in a
			// snackbar whose Undo brings it back.
			await expect( parentTitle ).toBeVisible();
			await archiveFromSidebar();
			await expect( parentTitle ).toHaveCount( 0 );
			await expect( archivedSnackbar ).toBeVisible();
			await archivedSnackbar
				.getByRole( 'button', { name: 'Undo' } )
				.click();
			await expect( parentTitle ).toBeVisible();

			await archiveFromSidebar();
			await expect( parentTitle ).toHaveCount( 0 );

			// The canvas keeps the page open, read only, without the actions
			// that don't apply to an archived document.
			const banner = page.locator( '.cortext-lifecycle-notice' );
			await expect( banner ).toContainText(
				'This document is archived and read only.'
			);
			const documentActions = page.locator( '.cortext-document-actions' );
			await expect(
				documentActions.getByRole( 'button', {
					name: 'Publish',
					exact: true,
				} )
			).toHaveCount( 0 );
			await expect(
				documentActions.getByRole( 'button', { name: 'Add block' } )
			).toHaveCount( 0 );

			// The Archived view lists the page as one item that brings its
			// child back with it, next to the archived collection.
			await sidebar.locator( '.cortext-sidebar__archive-footer' ).click();
			const list = page.locator( '.cortext-sidebar__lifecycle' );
			await expect(
				list.getByRole( 'heading', { name: /Archived/ } )
			).toBeVisible();
			const parentItem = list
				.getByRole( 'option' )
				.filter( { hasText: PARENT_TITLE } );
			const collectionItem = list
				.getByRole( 'option' )
				.filter( { hasText: COLLECTION_TITLE } );
			await expect( parentItem ).toContainText( '+1' );
			await expect( collectionItem ).toContainText( '+1' );
			await expect(
				list.getByRole( 'option' ).filter( { hasText: CHILD_TITLE } )
			).toHaveCount( 0 );

			await parentItem.click();
			await expect( banner ).toContainText(
				'1 nested document comes back with it'
			);
			await banner.getByRole( 'button', { name: 'Restore' } ).click();
			await expect( parentItem ).toHaveCount( 0 );

			// The archived collection opens with its archived rows.
			await collectionItem.click();
			await expect(
				page
					.frameLocator( '[name="editor-canvas"]' )
					.getByText( ROW_TITLE )
			).toBeVisible();

			// Moving it to Trash asks first, then the view has nothing left.
			await banner
				.getByRole( 'button', { name: 'Move to Trash' } )
				.click();
			const dialog = page.getByRole( 'dialog' );
			await expect( dialog ).toContainText( '30 days' );
			await dialog
				.getByRole( 'button', { name: 'Move to Trash' } )
				.click();
			await expect( collectionItem ).toHaveCount( 0 );
			await expect( page.getByText( 'Nothing archived' ) ).toBeVisible();

			// Back hands the sidebar back to the tree, where the restored
			// page is again.
			await list.getByRole( 'button', { name: 'Back' } ).click();
			await expect( parentTitle ).toBeVisible();
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_documents/${ fixture.row.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_documents/${ fixture.collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_fields/${ fixture.field.id }`
			);
			await deleteIfCreated(
				requestUtils,
				child && `/wp/v2/crtxt_documents/${ child.id }`
			);
			await deleteIfCreated(
				requestUtils,
				parent && `/wp/v2/crtxt_documents/${ parent.id }`
			);
		}
	} );
} );
