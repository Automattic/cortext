/**
 * E2E coverage for the page trash flow in the Cortext shell.
 *
 * Walks the user-visible path the unit tests can't: open a page, trash it
 * from the sidebar dropdown, see the Trash panel pick it up with the
 * cascade subpage count, the canvas locked behind a notice, and Restore
 * via the banner unwinding the whole thing.
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
			path: `/wp/v2/crtxt_pages/${ id }`,
			params: { force: true },
		} );
	} catch ( _error ) {
		// Best-effort cleanup; the test may have already deleted the page.
	}
}

test.describe( 'Page trash flow', () => {
	test( 'trash a parent from the sidebar, restore via the canvas banner', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let parent;
		let child;

		try {
			parent = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: PARENT_TITLE, status: 'private' },
			} );
			child = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
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

			// Active sidebar drops the whole subtree; the Trash panel
			// shows the cascade root with the subpage count.
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

			const trashList = page.locator( '.cortext-sidebar__trash-list' );
			await expect( trashList ).toContainText( PARENT_TITLE );
			await expect( trashList ).toContainText( '1 subpage' );

			// Canvas keeps the parent open with a trashed banner.
			const notice = page.locator( '.cortext-canvas__notice' );
			await expect( notice ).toContainText(
				'This document is in trash.'
			);

			// Restore via the banner. Subtree returns; banner disappears.
			await notice.getByRole( 'button', { name: 'Restore' } ).click();

			await expect( notice ).toHaveCount( 0 );
			await expect(
				sidebar.getByRole( 'button', {
					name: PARENT_TITLE,
					exact: true,
				} )
			).toBeVisible();
			await expect(
				page
					.locator( '#cortext-sidebar-trash-panel' )
					.getByRole( 'button', {
						name: PARENT_TITLE,
						exact: true,
					} )
			).toHaveCount( 0 );
		} finally {
			await deleteIfCreated( requestUtils, child?.id );
			await deleteIfCreated( requestUtils, parent?.id );
		}
	} );
} );
