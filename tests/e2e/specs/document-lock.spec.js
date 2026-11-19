/**
 * E2E coverage for locking a page.
 *
 * Locks a page from the sidebar menu, checks the Locked indicator and that
 * neither the editor nor REST can change it, then unlocks it and edits again.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const PAGE_TITLE = `E2E Lock ${ SUFFIX }`;

async function openSidebarMenuItem( page, title, item ) {
	const sidebar = page.locator( '.cortext-sidebar' );
	const rowTitle = sidebar.getByRole( 'button', {
		name: title,
		exact: true,
	} );
	await rowTitle.hover();
	// The row's drop-zone overlays sit on top of the menu trigger in stacking
	// order, so skip Playwright's actionability check.
	await sidebar
		.getByRole( 'button', { name: `Actions for ${ title }`, exact: true } )
		.click( { force: true } );
	await page.getByRole( 'menuitem', { name: item, exact: true } ).click();
}

test.describe( 'Document lock', () => {
	test( 'a locked page cannot be edited until it is unlocked', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		let doc;

		try {
			doc = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: PAGE_TITLE,
					status: 'private',
					content:
						'<!-- wp:paragraph --><p>Keep this text</p><!-- /wp:paragraph -->',
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ doc.id }`
			);
			await page.waitForFunction(
				( postId ) =>
					window.wp?.data
						?.select( 'core/editor' )
						?.getCurrentPostId?.() === postId,
				doc.id,
				{ timeout: 15_000 }
			);

			await openSidebarMenuItem( page, PAGE_TITLE, 'Lock' );

			await expect(
				page.locator( '.components-snackbar' ).filter( {
					hasText: 'Document locked.',
				} )
			).toBeVisible();
			await expect(
				page.locator( '.cortext-breadcrumbs .cortext-frozen-badge' )
			).toContainText( 'Locked' );
			await expect(
				page.locator( '.cortext-sidebar .cortext-frozen-badge' )
			).toBeVisible();

			const title = editor.canvas.locator( '.wp-block-post-title' );
			await title.click( { force: true } );
			await page.keyboard.type( 'XYZ' );
			await expect( title ).toHaveText( PAGE_TITLE );

			await expect(
				requestUtils.rest( {
					method: 'POST',
					path: `/wp/v2/crtxt_documents/${ doc.id }`,
					data: { title: 'Changed while locked' },
				} )
			).rejects.toMatchObject( { code: 'cortext_document_frozen' } );

			await openSidebarMenuItem( page, PAGE_TITLE, 'Unlock' );
			await expect(
				page.locator( '.cortext-breadcrumbs .cortext-frozen-badge' )
			).toHaveCount( 0 );

			const unlocked = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_documents/${ doc.id }`,
				data: { title: `${ PAGE_TITLE } edited` },
			} );
			expect( unlocked.title.raw ).toBe( `${ PAGE_TITLE } edited` );
			expect( unlocked.content.raw ).toContain( 'Keep this text' );
		} finally {
			if ( doc?.id ) {
				await requestUtils
					.rest( {
						method: 'DELETE',
						path: `/wp/v2/crtxt_documents/${ doc.id }`,
						params: { force: true },
					} )
					.catch( () => {} );
			}
		}
	} );
} );
