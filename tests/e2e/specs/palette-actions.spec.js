/**
 * E2E coverage for running document actions from the command palette.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SEARCH_PLACEHOLDER = 'Search or run a command';

async function createPage( requestUtils, data ) {
	return requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: { status: 'private', ...data },
	} );
}

async function deletePage( requestUtils, page ) {
	if ( ! page?.id ) {
		return;
	}
	// Archived documents refuse writes, deleting included.
	try {
		await requestUtils.rest( {
			method: 'POST',
			path: `/cortext/v1/documents/${ page.id }/unarchive`,
		} );
	} catch {
		// Not archived.
	}
	try {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/crtxt_documents/${ page.id }`,
			params: { force: true },
		} );
	} catch {
		// Cleanup is best effort.
	}
}

async function getPage( requestUtils, id ) {
	return requestUtils.rest( {
		path: `/wp/v2/crtxt_documents/${ id }`,
		params: { context: 'edit' },
	} );
}

async function openDocument( admin, page, document ) {
	await admin.visitAdminPage(
		'admin.php',
		`page=cortext&p=/${ document.slug }-${ document.id }`
	);
	await expect( page.locator( '.cortext-root' ) ).toBeVisible( {
		timeout: 15000,
	} );
}

async function openPalette( page ) {
	// The keyboard shortcut uses this same bridge but is flaky in headless
	// Chromium, so dispatch the event directly.
	await page.evaluate( () => {
		window.dispatchEvent( new Event( 'cortext:open-command-palette' ) );
	} );
	await expect( page.getByPlaceholder( SEARCH_PLACEHOLDER ) ).toBeVisible( {
		timeout: 5000,
	} );
}

test.describe( 'Command palette actions', () => {
	test( 'typing "archive" archives the open page, like the menu', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		let document;

		try {
			document = await createPage( requestUtils, {
				title: `Palette archive ${ suffix }`,
			} );
			await openDocument( admin, page, document );

			await openPalette( page );
			await page.getByPlaceholder( SEARCH_PLACEHOLDER ).fill( 'archive' );
			await expect(
				page.getByRole( 'option', { name: /^Archive/ } )
			).toHaveAttribute( 'aria-selected', 'true' );
			await page.keyboard.press( 'Enter' );

			await expect(
				page.locator( '.components-snackbar', {
					hasText: 'Document archived.',
				} )
			).toBeVisible();
			await expect
				.poll(
					async () =>
						( await getPage( requestUtils, document.id ) ).status
				)
				.toBe( 'crtxt_archived' );
		} finally {
			await deletePage( requestUtils, document );
		}
	} );

	test( '"Move to…" picks the new parent without leaving the palette', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		let parent;
		let document;

		try {
			parent = await createPage( requestUtils, {
				title: `Palette destination ${ suffix }`,
			} );
			document = await createPage( requestUtils, {
				title: `Palette moved ${ suffix }`,
			} );
			await openDocument( admin, page, document );

			await openPalette( page );
			const input = page.getByPlaceholder( SEARCH_PLACEHOLDER );
			await input.fill( 'Move to' );
			await page.getByRole( 'option', { name: /^Move to…/ } ).click();

			const destinationSearch = page.getByPlaceholder(
				'Search for a document to move it into'
			);
			await expect( destinationSearch ).toBeFocused();
			await destinationSearch.fill( `Palette destination ${ suffix }` );
			await expect(
				page.getByRole( 'option', {
					name: `Palette destination ${ suffix }`,
				} )
			).toHaveAttribute( 'aria-selected', 'true' );
			await page.keyboard.press( 'Enter' );

			await expect(
				page.locator( '.components-snackbar', {
					hasText: 'Document moved.',
				} )
			).toBeVisible();
			await expect
				.poll(
					async () =>
						( await getPage( requestUtils, document.id ) ).parent
				)
				.toBe( parent.id );
		} finally {
			await deletePage( requestUtils, document );
			await deletePage( requestUtils, parent );
		}
	} );

	test( 'renames the open page and still finds documents by name', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		let document;

		try {
			document = await createPage( requestUtils, {
				title: `Palette rename ${ suffix }`,
			} );
			await openDocument( admin, page, document );

			await openPalette( page );
			await page.getByPlaceholder( SEARCH_PLACEHOLDER ).fill( 'Rename' );
			await expect(
				page.getByRole( 'option', { name: /^Rename…/ } )
			).toHaveAttribute( 'aria-selected', 'true' );
			await page.keyboard.press( 'Enter' );
			const titleInput = page.getByPlaceholder( 'New title' );
			await expect( titleInput ).toHaveValue(
				`Palette rename ${ suffix }`
			);
			await titleInput.fill( `Palette renamed ${ suffix }` );
			await page.keyboard.press( 'Enter' );

			await expect
				.poll(
					async () =>
						( await getPage( requestUtils, document.id ) ).title.raw
				)
				.toBe( `Palette renamed ${ suffix }` );

			await openPalette( page );
			await page
				.getByPlaceholder( SEARCH_PLACEHOLDER )
				.fill( `Palette renamed ${ suffix }` );
			await expect(
				page.getByRole( 'option', {
					name: `Palette renamed ${ suffix }`,
				} )
			).toBeVisible( { timeout: 5000 } );
		} finally {
			await deletePage( requestUtils, document );
		}
	} );
} );
