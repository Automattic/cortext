/**
 * Covers the two sidebar entry points for collection creation: the Pages split
 * button and the row menu on a page. Both should open the new collection and
 * render the server-created owner data view.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SHELL_PATH = 'admin.php';
const SHELL_QUERY = 'page=cortext';

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
		// Best-effort cleanup; the record may already be gone.
	}
}

async function currentPostId( page ) {
	return page.evaluate(
		() =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.() ?? 0
	);
}

test.describe( 'Collection creation from the sidebar', () => {
	test( 'creates a top-level collection from the Pages split button', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const title = `E2E Sidebar Collection ${ suffix }`;

		try {
			await admin.visitAdminPage( SHELL_PATH, SHELL_QUERY );
			await expect( page.locator( '#cortext-sidebar' ) ).toBeVisible();

			const sidebar = page.locator( '.cortext-sidebar' );
			await sidebar.locator( '.cortext-sidebar__section--pages' ).hover();
			await sidebar
				.getByRole( 'button', {
					name: 'Create a document or collection',
				} )
				.click();
			await page
				.getByRole( 'menuitem', {
					name: 'New collection',
					exact: true,
				} )
				.click();

			// The new row opens in rename mode.
			const renameInput = page.locator(
				'.cortext-sidebar__rename input'
			);
			await expect( renameInput ).toBeVisible( { timeout: 15_000 } );
			await renameInput.fill( title );
			await renameInput.press( 'Enter' );

			// The collection opens in the canvas with its own table.
			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			await expect( canvas.locator( '.cortext-data-view' ) ).toBeVisible(
				{
					timeout: 15_000,
				}
			);

			fixture.collectionId = await currentPostId( page );
			expect( fixture.collectionId ).toBeGreaterThan( 0 );

			// The sidebar shows the new title.
			await expect(
				sidebar.getByRole( 'button', { name: title, exact: true } )
			).toBeVisible();

			// The server marked it as a collection.
			const saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_documents/${ fixture.collectionId }`,
				params: { context: 'edit' },
			} );
			expect( saved.cortext_defines_trait ).toBe( true );

			// It remains in the sidebar after a reload.
			await page.reload();
			await expect(
				sidebar.getByRole( 'button', { name: title, exact: true } )
			).toBeVisible();
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.collectionId &&
					`/wp/v2/crtxt_documents/${ fixture.collectionId }`
			);
		}
	} );

	test( "creates a nested collection from a page's row menu", async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const parentTitle = `E2E Parent Page ${ suffix }`;
		const childTitle = `E2E Nested Collection ${ suffix }`;

		try {
			fixture.parent = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: { title: parentTitle, status: 'private' },
			} );

			await admin.visitAdminPage(
				SHELL_PATH,
				`page=cortext&p=/${ fixture.parent.id }`
			);

			const sidebar = page.locator( '.cortext-sidebar' );
			const parentRow = sidebar.getByRole( 'button', {
				name: parentTitle,
				exact: true,
			} );
			await expect( parentRow ).toBeVisible();
			await parentRow.hover();
			await sidebar
				.getByRole( 'button', {
					name: `Actions for ${ parentTitle }`,
					exact: true,
				} )
				.click();
			await page
				.getByRole( 'menuitem', {
					name: 'Add collection inside',
				} )
				.click();

			const renameInput = page.locator(
				'.cortext-sidebar__rename input'
			);
			await expect( renameInput ).toBeVisible( { timeout: 15_000 } );
			await renameInput.fill( childTitle );
			await renameInput.press( 'Enter' );

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			await expect( canvas.locator( '.cortext-data-view' ) ).toBeVisible(
				{
					timeout: 15_000,
				}
			);

			fixture.childId = await currentPostId( page );
			expect( fixture.childId ).toBeGreaterThan( 0 );

			// The saved record is nested under the parent and marked as a collection.
			const saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_documents/${ fixture.childId }`,
				params: { context: 'edit' },
			} );
			expect( saved.parent ).toBe( fixture.parent.id );
			expect( saved.cortext_defines_trait ).toBe( true );

			// A collection row does not offer another child collection.
			const childRow = sidebar.getByRole( 'button', {
				name: childTitle,
				exact: true,
			} );
			await expect( childRow ).toBeVisible();
			await childRow.hover();
			await sidebar
				.getByRole( 'button', {
					name: `Actions for ${ childTitle }`,
					exact: true,
				} )
				.click();
			await expect(
				page.getByRole( 'menuitem', {
					name: 'Add collection inside',
				} )
			).toHaveCount( 0 );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.childId && `/wp/v2/crtxt_documents/${ fixture.childId }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.parent &&
					`/wp/v2/crtxt_documents/${ fixture.parent.id }`
			);
		}
	} );
} );
