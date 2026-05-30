/**
 * E2E coverage for searching pages and collection rows from the
 * command palette.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

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
		// Cleanup is best effort.
	}
}

async function appPath( page ) {
	return page.evaluate(
		() => new URL( window.location.href ).searchParams.get( 'p' ) || '/'
	);
}

async function openPalette( page ) {
	// Wait for the shell to mount before dispatching the bridge event.
	await expect( page.locator( '.cortext-root' ) ).toBeVisible( {
		timeout: 15000,
	} );
	// The keyboard shortcut uses this same bridge but is flaky in headless
	// Chromium, so dispatch the event directly.
	await page.evaluate( () => {
		window.dispatchEvent( new Event( 'cortext:open-command-palette' ) );
	} );
	await expect(
		page.getByPlaceholder( 'Search pages, collections, and actions' )
	).toBeVisible( { timeout: 5000 } );
}

test.describe( 'Command palette search', () => {
	test( 'finds a page by unique body text and navigates to it', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const token = `palettetoken${ suffix }`;
		const pageTitle = `Palette search page ${ suffix }`;
		let seededPage;

		try {
			seededPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: pageTitle,
					status: 'private',
					content: `<!-- wp:paragraph --><p>${ token } body text.</p><!-- /wp:paragraph -->`,
				},
			} );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );

			await openPalette( page );
			await page
				.getByPlaceholder( 'Search pages, collections, and actions' )
				.fill( token );

			const result = page.getByRole( 'option', { name: pageTitle } );
			await expect( result ).toBeVisible( { timeout: 5000 } );

			await result.click();

			await expect
				.poll( () => appPath( page ) )
				.toContain( `${ seededPage.id }` );
		} finally {
			await deleteIfCreated(
				requestUtils,
				seededPage && `/wp/v2/crtxt_documents/${ seededPage.id }`
			);
		}
	} );

	test( 'finds a row by title and navigates to the row itself', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const rowToken = `palrow${ suffix }`;
		const collectionTitle = `Palette rows ${ suffix }`;
		const fixture = {};

		try {
			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: collectionTitle,
					status: 'private',
				},
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: rowToken,
					status: 'private',
					cortext_trait: fixture.collection.id,
				},
			} );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );

			await openPalette( page );
			await page
				.getByPlaceholder( 'Search pages, collections, and actions' )
				.fill( rowToken );

			const result = page.getByRole( 'option', { name: rowToken } );
			await expect( result ).toBeVisible( { timeout: 5000 } );

			await result.click();

			await expect
				.poll( () => appPath( page ) )
				.toContain( `${ fixture.entry.id }` );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.entry && `/wp/v2/crtxt_documents/${ fixture.entry.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_documents/${ fixture.collection.id }`
			);
		}
	} );
} );
