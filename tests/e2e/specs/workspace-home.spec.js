/**
 * E2E coverage for the per-user workspace home preference.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const PAGE_HOME_TITLE = `E2E Home Page ${ SUFFIX }`;
const OTHER_PAGE_TITLE = `E2E Other Page ${ SUFFIX }`;
const COLLECTION_HOME_TITLE = `E2E Home Collection ${ SUFFIX }`;
const FALLBACK_TITLE = `E2E Home Fallback ${ SUFFIX }`;
const DELETED_HOME_TITLE = `E2E Deleted Home ${ SUFFIX }`;

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

async function appPath( page ) {
	return page.evaluate(
		() => new URL( window.location.href ).searchParams.get( 'p' ) || '/'
	);
}

async function setSidebarItemAsHome( page, title ) {
	const sidebar = page.locator( '.cortext-sidebar' );
	const rowTitle = sidebar.getByRole( 'button', {
		name: title,
		exact: true,
	} );
	await expect( rowTitle ).toBeVisible();
	await rowTitle.hover();

	const request = page.waitForResponse(
		( response ) =>
			response.url().includes( 'workspace-home' ) &&
			response.request().method() !== 'GET'
	);

	await sidebar
		.getByRole( 'button', {
			name: `Actions for ${ title }`,
			exact: true,
		} )
		.click( { force: true } );
	await page.getByRole( 'menuitem', { name: 'Set as home' } ).click();
	expect( ( await request ).status() ).toBe( 200 );
}

test.describe( 'Workspace home', () => {
	test( 'set a page as home and land there from the workspace root', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let homePage;
		let otherPage;

		try {
			homePage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: PAGE_HOME_TITLE,
					status: 'private',
				},
			} );
			otherPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: OTHER_PAGE_TITLE,
					status: 'private',
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ homePage.id }`
			);
			await waitForEditorPost( page, homePage.id );
			await setSidebarItemAsHome( page, PAGE_HOME_TITLE );

			await page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', {
					name: OTHER_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, otherPage.id );

			await page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', { name: 'Home', exact: true } )
				.click();
			await waitForEditorPost( page, homePage.id );

			await page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', {
					name: OTHER_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, otherPage.id );

			await page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', {
					name: 'Collapse sidebar',
					exact: true,
				} )
				.click();
			const collapsedSidebar = page.locator(
				'.cortext-sidebar[data-collapsed="true"]'
			);
			await expect( collapsedSidebar ).toBeVisible();
			await collapsedSidebar
				.getByRole( 'button', { name: 'Home', exact: true } )
				.click();
			await waitForEditorPost( page, homePage.id );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );
			await waitForEditorPost( page, homePage.id );
			await expect
				.poll( () => appPath( page ) )
				.toContain( String( homePage.id ) );
		} finally {
			await deleteIfCreated(
				requestUtils,
				otherPage && `/wp/v2/crtxt_pages/${ otherPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				homePage && `/wp/v2/crtxt_pages/${ homePage.id }`
			);
		}
	} );

	test( 'set a collection as home and land there from the workspace root', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let collection;

		try {
			collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_traits',
				data: {
					title: COLLECTION_HOME_TITLE,
					status: 'private',
					mode: 'full_page',
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/collection/${ collection.slug }-${ collection.id }`
			);
			// Full-page collections render inside the BlockCanvas iframe.
			const collectionCanvas = page.frameLocator(
				'[name="editor-canvas"]'
			);
			await expect(
				collectionCanvas.locator( '.cortext-data-view' )
			).toBeVisible( { timeout: 15_000 } );
			await setSidebarItemAsHome( page, COLLECTION_HOME_TITLE );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );
			await expect
				.poll( () => appPath( page ) )
				.toContain( '/collection/' );
			await expect(
				collectionCanvas.locator( '.cortext-data-view' )
			).toBeVisible( { timeout: 15_000 } );
		} finally {
			await deleteIfCreated(
				requestUtils,
				collection && `/wp/v2/crtxt_traits/${ collection.id }`
			);
		}
	} );

	test( 'falls back to the first page when the home is trashed', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let fallback;
		let deletedHome;

		try {
			fallback = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: FALLBACK_TITLE,
					status: 'private',
					menu_order: -100000,
				},
			} );
			deletedHome = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: DELETED_HOME_TITLE,
					status: 'private',
					menu_order: -99999,
				},
			} );
			await requestUtils.rest( {
				method: 'PUT',
				path: '/cortext/v1/workspace-home',
				data: { id: deletedHome.id },
			} );
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/crtxt_documents/${ deletedHome.id }`,
			} );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );
			await waitForEditorPost( page, fallback.id );
			await expect
				.poll( () => appPath( page ) )
				.toContain( String( fallback.id ) );
		} finally {
			await deleteIfCreated(
				requestUtils,
				deletedHome && `/wp/v2/crtxt_pages/${ deletedHome.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fallback && `/wp/v2/crtxt_pages/${ fallback.id }`
			);
		}
	} );
} );
