/**
 * Sidebar collapse + resize controls. Covers the toggle, the drag, the
 * keyboard shortcut, and reload persistence (the PHP bootstrap path).
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SHELL_PATH = 'admin.php';
const SHELL_QUERY = 'page=cortext';

const RAIL_WIDTH = 56;

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

async function readSidebarWidth( page ) {
	return page.evaluate( () => {
		const sidebar = document.getElementById( 'cortext-sidebar' );
		return sidebar ? Math.round( sidebar.getBoundingClientRect().width ) : 0;
	} );
}

async function readChromeLabelAlignment( page ) {
	return page.evaluate( () => {
		const header = document.querySelector( '.cortext-sidebar__header' );
		const brand = document.querySelector( '.cortext-sidebar__brand' );
		const breadcrumb = document.querySelector(
			'.cortext-breadcrumbs__segment.is-current'
		);
		if ( ! header || ! brand || ! breadcrumb ) {
			return null;
		}

		const headerBox = header.getBoundingClientRect();
		const brandBox = brand.getBoundingClientRect();
		const breadcrumbBox = breadcrumb.getBoundingClientRect();

		const headerCenter = headerBox.top + headerBox.height / 2;
		const brandCenter = brandBox.top + brandBox.height / 2;
		const breadcrumbCenter =
			breadcrumbBox.top + breadcrumbBox.height / 2;

		return {
			labelDelta: Math.abs( brandCenter - breadcrumbCenter ),
			headerDelta: Math.abs( brandCenter - headerCenter ),
		};
	} );
}

async function clearSidebarPrefs( page ) {
	await page.evaluate( () => {
		try {
			window.localStorage.removeItem( 'cortext.sidebarCollapsed' );
			window.localStorage.removeItem( 'cortext.sidebarWidth' );
		} catch ( _e ) {}
	} );
}

test.describe( 'Sidebar layout controls', () => {
	test.beforeEach( async ( { admin, page } ) => {
		await admin.visitAdminPage( SHELL_PATH, SHELL_QUERY );
		await expect( page.locator( '#cortext-sidebar' ) ).toBeVisible();
		await clearSidebarPrefs( page );
		await page.reload();
		await expect( page.locator( '#cortext-sidebar' ) ).toBeVisible();
	} );

	test( 'collapse toggle pins to rail width and persists across reload', async ( {
		page,
	} ) => {
		const expandedWidth = await readSidebarWidth( page );
		expect( expandedWidth ).toBeGreaterThan( 200 );

		await page.getByRole( 'button', { name: 'Collapse sidebar' } ).click();

		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeLessThanOrEqual( RAIL_WIDTH + 2 );
		await expect(
			page.locator( '#cortext-root' )
		).toHaveAttribute( 'data-sidebar-collapsed', 'true' );

		await page.reload();

		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeLessThanOrEqual( RAIL_WIDTH + 2 );
		await expect(
			page.locator( '#cortext-root' )
		).toHaveAttribute( 'data-sidebar-collapsed', 'true' );
		await expect(
			page.getByRole( 'button', { name: 'Expand sidebar' } )
		).toBeVisible();
	} );

	test( 'aligns the brand and current breadcrumb text vertically', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const fixture = {};

		try {
			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: `E2E Chrome Alignment ${ suffix }`,
					status: 'private',
				},
			} );

			await admin.visitAdminPage(
				SHELL_PATH,
				`page=cortext&p=/page/${ fixture.page.id }`
			);

			await expect(
				page.locator( '.cortext-sidebar__brand' )
			).toBeVisible();
			await expect(
				page.locator( '.cortext-breadcrumbs__segment.is-current' )
			).toHaveText( `E2E Chrome Alignment ${ suffix }` );

			const alignment = await readChromeLabelAlignment( page );
			expect( alignment ).not.toBeNull();
			expect( alignment.labelDelta ).toBeLessThanOrEqual( 2 );
			expect( alignment.headerDelta ).toBeLessThanOrEqual( 2 );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.page ? `/wp/v2/crtxt_pages/${ fixture.page.id }` : null
			);
		}
	} );

	test( 'resize handle drags to a new width and persists', async ( {
		page,
	} ) => {
		const handle = page.locator( '.cortext-sidebar__resize-handle' );
		await expect( handle ).toBeVisible();

		const handleBox = await handle.boundingBox();
		const startX = handleBox.x + handleBox.width / 2;
		const startY = handleBox.y + handleBox.height / 2;
		const targetX = startX + 80;

		await page.mouse.move( startX, startY );
		await page.mouse.down();
		await page.mouse.move( targetX, startY, { steps: 10 } );
		await page.mouse.up();

		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeGreaterThan( 320 );

		const beforeReload = await readSidebarWidth( page );
		await page.reload();

		const afterReload = await readSidebarWidth( page );
		expect( Math.abs( afterReload - beforeReload ) ).toBeLessThanOrEqual(
			2
		);
	} );

	test( 'Cmd/Ctrl+\\ toggles collapse', async ( { page } ) => {
		const modifier =
			process.platform === 'darwin' ? 'Meta+\\' : 'Control+\\';

		await page.locator( '#cortext-root' ).click();
		await page.keyboard.press( modifier );

		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeLessThanOrEqual( RAIL_WIDTH + 2 );

		await page.keyboard.press( modifier );

		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeGreaterThan( 200 );
	} );

	test( 'arrow keys nudge width on the focused handle', async ( { page } ) => {
		const handle = page.locator( '.cortext-sidebar__resize-handle' );
		await handle.focus();

		const startWidth = await readSidebarWidth( page );

		await page.keyboard.press( 'ArrowRight' );
		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeGreaterThan( startWidth );

		await page.keyboard.press( 'End' );
		await expect.poll( () => readSidebarWidth( page ) ).toBeGreaterThan(
			startWidth + 100
		);

		await page.keyboard.press( 'Home' );
		await expect.poll( () => readSidebarWidth( page ) ).toBeLessThan(
			startWidth + 1
		);
	} );
} );
