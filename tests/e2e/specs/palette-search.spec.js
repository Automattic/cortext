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
		page.getByPlaceholder( 'Search or run a command' )
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
				.getByPlaceholder( 'Search or run a command' )
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

	test( 'previews the first recent document on open', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		let seededPage;

		try {
			// Put a document in recents so the list is never empty.
			seededPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `Palette recent ${ suffix }`,
					status: 'private',
				},
			} );
			await requestUtils.rest( {
				method: 'POST',
				path: '/cortext/v1/recents',
				data: { id: seededPage.id },
			} );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );

			await openPalette( page );

			// Opening Cortext can touch the home document, so the first recent
			// is not necessarily the seeded one.
			const firstRecent = page
				.getByRole( 'option' )
				.first()
				.locator( '.commands-command-menu__item-label' );
			await expect( firstRecent ).toBeVisible( { timeout: 5000 } );

			const preview = page.locator( '.cortext-command-palette__preview' );
			await expect( preview ).toBeVisible();
			await expect(
				preview.locator( '.cortext-command-palette__preview-title' )
			).toHaveText( await firstRecent.innerText() );
		} finally {
			await deleteIfCreated(
				requestUtils,
				seededPage && `/wp/v2/crtxt_documents/${ seededPage.id }`
			);
		}
	} );

	test( 'updates the preview when the highlighted result changes', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const token = `palprev${ suffix }`;
		const bodyText = `Preview body for ${ token }.`;
		const seeded = [];
		const idsByTitle = {};

		try {
			for ( const name of [ 'alpha', 'beta' ] ) {
				const title = `${ token } ${ name }`;
				const document = await requestUtils.rest( {
					method: 'POST',
					path: '/wp/v2/crtxt_documents',
					data: {
						title,
						status: 'private',
						content: `<!-- wp:paragraph --><p>${ bodyText }</p><!-- /wp:paragraph -->`,
					},
				} );
				seeded.push( document );
				idsByTitle[ title ] = document.id;
			}

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );

			// The preview prefetches the listed documents in one request, so
			// moving the highlight needs no request of its own. Count only the
			// preview's single-document requests: on an empty site the canvas
			// opens a seeded document as home and loads it too. Decode the URL
			// because plain permalinks send the route in `rest_route`.
			const recordRequests = [];
			const seededIds = seeded.map( ( document ) => document.id );
			page.on( 'request', ( request ) => {
				if ( request.method() !== 'GET' ) {
					return;
				}
				const url = decodeURIComponent( request.url() );
				const match = url.match( /crtxt_documents\/(\d+)/ );
				if (
					match &&
					url.includes( 'content.raw' ) &&
					seededIds.includes( Number( match[ 1 ] ) )
				) {
					recordRequests.push( Number( match[ 1 ] ) );
				}
			} );

			await openPalette( page );
			const prefetched = page.waitForResponse( ( response ) => {
				const url = decodeURIComponent( response.url() );
				// The first result can land before the prefetch, which then
				// asks only for the rest.
				return (
					/crtxt_documents(?!\/)/.test( url ) &&
					url.includes( 'include' ) &&
					seededIds.some( ( id ) => url.includes( `${ id }` ) )
				);
			} );
			await page
				.getByPlaceholder( 'Search or run a command' )
				.fill( token );

			const options = page.getByRole( 'option' );
			await expect( options.first() ).toBeVisible( { timeout: 5000 } );

			const preview = page.locator( '.cortext-command-palette__preview' );
			const previewTitle = preview.locator(
				'.cortext-command-palette__preview-title'
			);
			await expect( preview ).toBeVisible();

			// The preview starts with the first highlighted result.
			const firstLabel = await options
				.first()
				.locator( '.commands-command-menu__item-label' )
				.innerText();
			await expect( previewTitle ).toHaveText( firstLabel );

			// BlockPreview renders the body inside an iframe.
			await expect(
				preview.frameLocator( 'iframe' ).getByText( bodyText )
			).toBeVisible( { timeout: 15000 } );

			const secondLabel = await options
				.nth( 1 )
				.locator( '.commands-command-menu__item-label' )
				.innerText();
			expect( ( await prefetched ).ok() ).toBe( true );
			await page.keyboard.press( 'ArrowDown' );

			await expect( previewTitle ).toHaveText( secondLabel );
			await expect(
				preview.frameLocator( 'iframe' ).getByText( bodyText )
			).toBeVisible( { timeout: 15000 } );

			// Going back to a document already previewed reuses the record.
			await page.keyboard.press( 'ArrowUp' );

			await expect( previewTitle ).toHaveText( firstLabel );
			await expect(
				preview.frameLocator( 'iframe' ).getByText( bodyText )
			).toBeVisible( { timeout: 15000 } );

			// Only the first preview may race the prefetch.
			expect( recordRequests ).not.toContain( idsByTitle[ secondLabel ] );
			expect( recordRequests.length ).toBeLessThanOrEqual( 1 );

			// The preview stores a partial record. Opening the document must
			// still load the full one into the editor.
			await page.keyboard.press( 'Enter' );
			await expect(
				page
					.frameLocator( 'iframe[name="editor-canvas"]' )
					.getByText( bodyText )
			).toBeVisible( { timeout: 15000 } );
		} finally {
			for ( const document of seeded ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_documents/${ document.id }`
				);
			}
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
					cortext_collection: true,
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
				.getByPlaceholder( 'Search or run a command' )
				.fill( rowToken );

			const result = page.getByRole( 'option', { name: rowToken } );
			await expect( result ).toBeVisible( { timeout: 5000 } );

			await result.click();

			await expect
				.poll( () => appPath( page ) )
				.toMatch( new RegExp( `[/-]${ fixture.entry.id }$` ) );
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
