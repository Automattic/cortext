/**
 * E2E coverage for route transitions that should not tear down the canvas.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const FIRST_PAGE_TITLE = `E2E Lifecycle Page A ${ SUFFIX }`;
const SECOND_PAGE_TITLE = `E2E Lifecycle Page B ${ SUFFIX }`;
const COLLECTION_TITLE = `E2E Lifecycle Collection ${ SUFFIX }`;
const ENTRY_TITLE = `E2E Lifecycle Entry ${ SUFFIX }`;
const HISTORY_FIRST_PAGE_TITLE = `E2E History Page A ${ SUFFIX }`;
const HISTORY_SECOND_PAGE_TITLE = `E2E History Page B ${ SUFFIX }`;
const HISTORY_COLLECTION_TITLE = `E2E History Collection ${ SUFFIX }`;

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
	} catch ( _error ) {
		// Best-effort cleanup; the record may already be gone.
	}
}

async function waitForEditorPost( page, postId ) {
	await page.waitForFunction(
		( expectedPostId ) =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.() ===
			expectedPostId,
		postId,
		{ timeout: 15_000 }
	);
}

test.describe( 'Navigation lifecycle', () => {
	test( 'top bar back and forward stay in sync with browser history', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			fixture.firstPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: HISTORY_FIRST_PAGE_TITLE, status: 'private' },
			} );
			fixture.secondPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: HISTORY_SECOND_PAGE_TITLE, status: 'private' },
			} );
			fixture.slug = `e2ehist${ SUFFIX }`;
			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: HISTORY_COLLECTION_TITLE,
					status: 'private',
					meta: { slug: fixture.slug },
				},
			} );

			const backButton = page.getByRole( 'button', {
				name: 'Go back',
			} );
			const forwardButton = page.getByRole( 'button', {
				name: 'Go forward',
			} );
			const sidebar = page.locator( '.cortext-sidebar' );
			const breadcrumb = page.getByRole( 'navigation', {
				name: 'Breadcrumb',
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/page/${ fixture.firstPage.id }`
			);
			await waitForEditorPost( page, fixture.firstPage.id );
			await expect( backButton ).toBeDisabled();
			await expect( forwardButton ).toBeDisabled();

			await sidebar
				.getByRole( 'button', {
					name: HISTORY_SECOND_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, fixture.secondPage.id );
			await expect( backButton ).toBeEnabled();
			await expect( forwardButton ).toBeDisabled();

			await backButton.click();
			await waitForEditorPost( page, fixture.firstPage.id );
			await expect( backButton ).toBeDisabled();
			await expect( forwardButton ).toBeEnabled();

			await forwardButton.click();
			await waitForEditorPost( page, fixture.secondPage.id );
			await expect( backButton ).toBeEnabled();
			await expect( forwardButton ).toBeDisabled();

			await sidebar
				.getByRole( 'button', {
					name: HISTORY_COLLECTION_TITLE,
					exact: true,
				} )
				.click();
			await expect( breadcrumb ).toContainText(
				HISTORY_COLLECTION_TITLE
			);
			await expect( backButton ).toBeEnabled();
			await expect( forwardButton ).toBeDisabled();

			await page.goBack();
			await waitForEditorPost( page, fixture.secondPage.id );
			await expect( forwardButton ).toBeEnabled();

			await page.goForward();
			await expect( breadcrumb ).toContainText(
				HISTORY_COLLECTION_TITLE
			);
			await expect( forwardButton ).toBeDisabled();
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.secondPage &&
					`/wp/v2/crtxt_pages/${ fixture.secondPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.firstPage &&
					`/wp/v2/crtxt_pages/${ fixture.firstPage.id }`
			);
		}
	} );

	test( 'preserves the mounted page canvas and waits for collection rows', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		let releaseRows = () => {};

		try {
			fixture.firstPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: FIRST_PAGE_TITLE, status: 'private' },
			} );
			fixture.secondPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: SECOND_PAGE_TITLE, status: 'private' },
			} );
			fixture.slug = `e2elife${ SUFFIX }`;
			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: COLLECTION_TITLE,
					status: 'private',
					meta: { slug: fixture.slug },
				},
			} );
			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ fixture.slug }`,
				data: { title: ENTRY_TITLE, status: 'private' },
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/page/${ fixture.firstPage.id }`
			);
			await waitForEditorPost( page, fixture.firstPage.id );

			const canvasBefore = await page
				.locator( '.cortext-canvas' )
				.elementHandle();
			expect( canvasBefore ).not.toBeNull();

			const sidebar = page.locator( '.cortext-sidebar' );
			await sidebar
				.getByRole( 'button', {
					name: SECOND_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, fixture.secondPage.id );

			const canvasAfter = await page
				.locator( '.cortext-canvas' )
				.elementHandle();
			expect( canvasAfter ).not.toBeNull();
			await expect( page.locator( '.cortext-canvas' ) ).toHaveCount( 1 );
			const keptCanvas = await page.evaluate(
				( [ before, after ] ) => before === after,
				[ canvasBefore, canvasAfter ]
			);
			expect( keptCanvas ).toBe( true );

			const rowsGate = new Promise( ( resolve ) => {
				releaseRows = resolve;
			} );
			await page.route(
				'**/wp-json/cortext/v1/rows**',
				async ( route ) => {
					if (
						route
							.request()
							.url()
							.includes( `collection=${ fixture.collection.id }` )
					) {
						await rowsGate;
					}
					await route.continue();
				}
			);
			const rowsRequest = page.waitForRequest(
				( request ) =>
					request.url().includes( '/wp-json/cortext/v1/rows' ) &&
					request
						.url()
						.includes( `collection=${ fixture.collection.id }` )
			);

			await sidebar
				.getByRole( 'button', {
					name: COLLECTION_TITLE,
					exact: true,
				} )
				.click();
			await rowsRequest;

			await expect(
				page.locator(
					'.cortext-workspace__pane[data-active="true"] .cortext-canvas'
				)
			).toBeVisible();
			await expect(
				page.locator(
					'.cortext-workspace__pane[data-active="true"] .cortext-data-view'
				)
			).toHaveCount( 0 );

			releaseRows();

			const activeCollection = page.locator(
				'.cortext-workspace__pane[data-active="true"] .cortext-data-view'
			);
			await expect( activeCollection ).toBeVisible();
			await expect( activeCollection ).toContainText( ENTRY_TITLE );

			const pagePane = page
				.locator( '.cortext-workspace__pane' )
				.filter( { has: page.locator( '.cortext-canvas' ) } );
			await expect( pagePane ).toHaveAttribute( 'data-active', 'false' );
			await expect( pagePane ).toHaveCSS( 'visibility', 'visible' );

			await sidebar
				.getByRole( 'button', {
					name: SECOND_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, fixture.secondPage.id );
			await expect( pagePane ).toHaveAttribute( 'data-active', 'true' );
			const canvasAfterCollection = await page
				.locator( '.cortext-canvas' )
				.elementHandle();
			const keptCanvasAfterCollection = await page.evaluate(
				( [ before, after ] ) => before === after,
				[ canvasAfter, canvasAfterCollection ]
			);
			expect( keptCanvasAfterCollection ).toBe( true );
		} finally {
			releaseRows();
			await deleteIfCreated(
				requestUtils,
				fixture.entry &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.secondPage &&
					`/wp/v2/crtxt_pages/${ fixture.secondPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.firstPage &&
					`/wp/v2/crtxt_pages/${ fixture.firstPage.id }`
			);
		}
	} );
} );
