/**
 * E2E coverage for the page trash flow in the Cortext shell.
 *
 * Walks the user-visible path the unit tests can't: open a page, trash it
 * from the sidebar dropdown, see the snackbar and the canvas locked behind a
 * notice, then find it in Trash with its nested document, open it there and
 * restore the whole thing from its banner.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const PARENT_TITLE = `E2E Trash Parent ${ SUFFIX }`;
const CHILD_TITLE = `E2E Trash Child ${ SUFFIX }`;

async function deleteIfCreated( requestUtils, id ) {
	if ( ! id ) {
		return;
	}
	try {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/crtxt_documents/${ id }`,
			params: { force: true },
		} );
	} catch {
		// Best-effort cleanup; the test may have already deleted the page.
	}
}

test.describe( 'Page trash flow', () => {
	test( 'trash a parent from the sidebar, restore it from the Trash view', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let parent;
		let child;

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

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ parent.id }`
			);

			// Wait for the editor to load the parent.
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
			await expect( parentTitle ).toBeVisible();

			// Hover the row to reveal the dropdown trigger (opacity-0 idle).
			await parentTitle.hover();

			// `force: true` bypasses Playwright's actionability check, which
			// trips on the ellipsis button: the row's drop-zone overlays sit
			// on top in stacking order even though `pointer-events: none` lets
			// the click through at the browser level.
			await sidebar
				.getByRole( 'button', {
					name: `Actions for ${ PARENT_TITLE }`,
					exact: true,
				} )
				.click( { force: true } );
			await page.getByRole( 'menuitem', { name: 'Trash' } ).click();

			// Active sidebar drops the whole subtree, and a snackbar says what
			// went to Trash.
			await expect(
				sidebar.getByRole( 'button', {
					name: PARENT_TITLE,
					exact: true,
				} )
			).toHaveCount( 0 );
			await expect(
				sidebar.getByRole( 'button', {
					name: CHILD_TITLE,
					exact: true,
				} )
			).toHaveCount( 0 );
			await expect(
				page.locator( '.components-snackbar' ).filter( {
					hasText: 'Document and 1 nested document moved to Trash.',
				} )
			).toBeVisible();

			// Canvas keeps the parent open with a trashed banner.
			await expect(
				page
					.locator( '.cortext-lifecycle-notice' )
					.filter( { hasText: 'This document is in the Trash.' } )
			).toBeVisible();
			// Publishing and adding blocks don't apply to a deleted document.
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

			// The Trash view lists the parent as one item that brings its
			// child back with it.
			await sidebar.locator( '.cortext-sidebar__trash-footer' ).click();
			// Trash takes over the sidebar with its list, and the selected item
			// opens in the canvas.
			const trashList = page.locator( '.cortext-sidebar__lifecycle' );
			const parentItem = trashList
				.getByRole( 'option' )
				.filter( { hasText: PARENT_TITLE } );
			await expect( parentItem ).toContainText( '+1' );
			await expect(
				trashList
					.getByRole( 'option' )
					.filter( { hasText: CHILD_TITLE } )
			).toHaveCount( 0 );

			await parentItem.click();
			const banner = page.locator( '.cortext-lifecycle-notice' );
			await expect( banner ).toContainText(
				'1 nested document comes back with it'
			);

			// Leaving a Trash that still has items stays left.
			await trashList.getByRole( 'button', { name: 'Back' } ).click();
			await expect( page ).not.toHaveURL( /p=%2Ftrash/ );

			await sidebar.locator( '.cortext-sidebar__trash-footer' ).click();
			await parentItem.click();
			await banner.getByRole( 'button', { name: 'Restore' } ).click();
			await expect( parentItem ).toHaveCount( 0 );

			// Back hands the sidebar back to the document tree, where the
			// restored parent is again.
			await trashList.getByRole( 'button', { name: 'Back' } ).click();
			await expect(
				sidebar.getByRole( 'button', {
					name: PARENT_TITLE,
					exact: true,
				} )
			).toBeVisible();
		} finally {
			await deleteIfCreated( requestUtils, child?.id );
			await deleteIfCreated( requestUtils, parent?.id );
		}
	} );
} );
