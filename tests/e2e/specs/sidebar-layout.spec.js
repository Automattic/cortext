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
	} catch {
		// Best-effort cleanup; the record may already be gone.
	}
}

async function readSidebarWidth( page ) {
	return page.evaluate( () => {
		const sidebar = document.getElementById( 'cortext-sidebar' );
		return sidebar
			? Math.round( sidebar.getBoundingClientRect().width )
			: 0;
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
		const breadcrumbCenter = breadcrumbBox.top + breadcrumbBox.height / 2;

		return {
			labelDelta: Math.abs( brandCenter - breadcrumbCenter ),
			headerDelta: Math.abs( brandCenter - headerCenter ),
		};
	} );
}

async function readCollapsedRailAlignment( page ) {
	return page.evaluate( () => {
		const header = document.querySelector( '.cortext-sidebar__header' );
		const topbar = document.querySelector( '.cortext-topbar' );
		const toggle = document.querySelector(
			'.cortext-sidebar__collapse-toggle'
		);
		const back = document.querySelector( '.cortext-sidebar__back' );
		const theme = document.querySelector(
			'.cortext-sidebar__theme-toggle'
		);
		if ( ! header || ! topbar || ! toggle || ! back || ! theme ) {
			return null;
		}

		const box = ( element ) => {
			const rect = element.getBoundingClientRect();
			return {
				left: rect.left,
				top: rect.top,
				width: rect.width,
				height: rect.height,
				xCenter: rect.left + rect.width / 2,
				yCenter: rect.top + rect.height / 2,
			};
		};

		const headerBox = box( header );
		const topbarBox = box( topbar );
		const toggleBox = box( toggle );
		const backBox = box( back );
		const themeBox = box( theme );

		return {
			headerHeightDelta: Math.abs( headerBox.height - topbarBox.height ),
			toggleHeaderDelta: Math.abs(
				toggleBox.yCenter - headerBox.yCenter
			),
			footerIconDelta: Math.abs( backBox.xCenter - themeBox.xCenter ),
		};
	} );
}

async function readRenameRowGeometry( page ) {
	return page.evaluate( () => {
		const input = document.querySelector(
			'.cortext-sidebar__rename input'
		);
		const row = input?.closest( '.cortext-sidebar__row' );
		if ( ! input || ! row ) {
			return null;
		}

		const inputBox = input.getBoundingClientRect();
		const rowBox = row.getBoundingClientRect();

		return {
			inputHeight: inputBox.height,
			rowHeight: rowBox.height,
			overflowTop: rowBox.top - inputBox.top,
			overflowBottom: inputBox.bottom - rowBox.bottom,
		};
	} );
}

async function readFooterIconGeometry( page ) {
	return page.evaluate( () => {
		const back = document.querySelector( '.cortext-sidebar__back' );
		const theme = document.querySelector(
			'.cortext-sidebar__theme-toggle'
		);
		if ( ! back || ! theme ) {
			return null;
		}

		const box = ( element ) => {
			const rect = element.getBoundingClientRect();
			return {
				width: rect.width,
				height: rect.height,
				xCenter: rect.left + rect.width / 2,
				yCenter: rect.top + rect.height / 2,
			};
		};

		return {
			back: box( back ),
			theme: box( theme ),
		};
	} );
}

async function readThemePopoverPlacement( page ) {
	return page.evaluate( () => {
		const trigger = document.querySelector(
			'.cortext-sidebar__theme-toggle'
		);
		const popover = Array.from(
			document.querySelectorAll( '.components-popover' )
		).find( ( element ) => element.textContent.includes( 'Match system' ) );
		if ( ! trigger || ! popover ) {
			return null;
		}

		const triggerBox = trigger.getBoundingClientRect();
		const popoverBox = popover.getBoundingClientRect();

		return {
			triggerTop: triggerBox.top,
			popoverBottom: popoverBox.bottom,
			gap: triggerBox.top - popoverBox.bottom,
		};
	} );
}

async function readButtonChromeState( locator ) {
	return locator.evaluate( ( element ) => {
		const styles = window.getComputedStyle( element );
		return {
			backgroundColor: styles.backgroundColor,
			color: styles.color,
		};
	} );
}

async function clearSidebarPrefs( page ) {
	await page.evaluate( () => {
		try {
			window.localStorage.removeItem( 'cortext.sidebarCollapsed' );
			window.localStorage.removeItem( 'cortext.sidebarWidth' );
		} catch {}
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
		const collapsedFooter = await readFooterIconGeometry( page );
		await expect( page.locator( '#cortext-root' ) ).toHaveAttribute(
			'data-sidebar-collapsed',
			'true'
		);

		await page.reload();

		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeLessThanOrEqual( RAIL_WIDTH + 2 );
		await expect( page.locator( '#cortext-root' ) ).toHaveAttribute(
			'data-sidebar-collapsed',
			'true'
		);
		await expect(
			page.getByRole( 'button', { name: 'Expand sidebar' } )
		).toBeVisible();

		const railAlignment = await readCollapsedRailAlignment( page );
		expect( railAlignment ).not.toBeNull();
		expect( railAlignment.headerHeightDelta ).toBeLessThanOrEqual( 1 );
		expect( railAlignment.toggleHeaderDelta ).toBeLessThanOrEqual( 1 );
		expect( railAlignment.footerIconDelta ).toBeLessThanOrEqual( 1 );

		await page.getByRole( 'button', { name: 'Expand sidebar' } ).click();
		const expandingFooter = await readFooterIconGeometry( page );

		expect( collapsedFooter ).not.toBeNull();
		expect( expandingFooter ).not.toBeNull();
		expect( expandingFooter.back.width ).toBe( collapsedFooter.back.width );
		expect( expandingFooter.theme.width ).toBe(
			collapsedFooter.theme.width
		);
		expect( expandingFooter.back.height ).toBe(
			collapsedFooter.back.height
		);
		expect( expandingFooter.theme.height ).toBe(
			collapsedFooter.theme.height
		);

		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeGreaterThan( 200 );

		await page.getByRole( 'button', { name: 'Color scheme' } ).click();
		await expect(
			page.getByRole( 'menuitem', { name: 'Match system' } )
		).toBeVisible();
		const themePlacement = await readThemePopoverPlacement( page );
		expect( themePlacement ).not.toBeNull();
		expect( themePlacement.popoverBottom ).toBeLessThanOrEqual(
			themePlacement.triggerTop + 1
		);
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

	test( 'keeps settings chrome responsive on hover in both themes', async ( {
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
					title: `E2E Cog Chrome ${ suffix }`,
					status: 'private',
				},
			} );

			await admin.visitAdminPage(
				SHELL_PATH,
				`page=cortext&p=/page/${ fixture.page.id }`
			);

			const settings = page.locator(
				'.cortext-document-actions .components-button[aria-label="Settings"]'
			);
			await expect( settings ).toBeVisible();

			await page.evaluate( () => {
				document
					.getElementById( 'cortext-root' )
					?.setAttribute( 'data-theme', 'light' );
			} );

			if (
				await settings.evaluate( ( element ) =>
					element.classList.contains( 'is-pressed' )
				)
			) {
				await settings.click();
			}

			await expect( settings ).not.toHaveClass( /is-pressed/ );
			await page.mouse.move( 0, 0 );
			const unpressedBeforeHover = await readButtonChromeState(
				settings
			);

			await settings.hover();
			const lightUnpressedAfterHover = await readButtonChromeState(
				settings
			);

			expect( lightUnpressedAfterHover.backgroundColor ).not.toBe(
				unpressedBeforeHover.backgroundColor
			);
			expect( lightUnpressedAfterHover.color ).not.toBe(
				unpressedBeforeHover.color
			);
			expect( lightUnpressedAfterHover.backgroundColor ).not.toBe(
				'rgb(30, 30, 30)'
			);

			await page.mouse.move( 0, 0 );
			await page.evaluate( () => {
				document
					.getElementById( 'cortext-root' )
					?.setAttribute( 'data-theme', 'dark' );
			} );
			const darkUnpressedBeforeHover = await readButtonChromeState(
				settings
			);

			await settings.hover();
			const darkUnpressedAfterHover = await readButtonChromeState(
				settings
			);

			expect( darkUnpressedAfterHover.backgroundColor ).not.toBe(
				darkUnpressedBeforeHover.backgroundColor
			);
			expect( darkUnpressedAfterHover.color ).not.toBe(
				darkUnpressedBeforeHover.color
			);
			expect( darkUnpressedAfterHover.backgroundColor ).not.toBe(
				'rgb(30, 30, 30)'
			);

			if (
				await settings.evaluate(
					( element ) => ! element.classList.contains( 'is-pressed' )
				)
			) {
				await settings.click();
			}

			await expect( settings ).toHaveClass( /is-pressed/ );
			await page.mouse.move( 0, 0 );
			const beforeHover = await readButtonChromeState( settings );

			await settings.hover();
			const afterHover = await readButtonChromeState( settings );

			expect( afterHover.backgroundColor ).not.toBe(
				beforeHover.backgroundColor
			);
			expect( afterHover.color ).toBe( beforeHover.color );
			expect( afterHover.backgroundColor ).not.toBe(
				'rgb(30, 30, 30)'
			);

			const sidebar = page.locator( '.cortext-sidebar' );
			const title = sidebar.getByRole( 'button', {
				name: `E2E Cog Chrome ${ suffix }`,
				exact: true,
			} );
			const selectedRow = title.locator(
				'xpath=ancestor::*[contains(concat(" ", normalize-space(@class), " "), " cortext-sidebar__row ")][1]'
			);

			await expect( title ).toHaveClass( /is-pressed/ );
			await expect( selectedRow ).toHaveClass( /is-selected/ );

			const titleBeforeHover = await readButtonChromeState( title );
			await title.hover();
			const titleAfterHover = await readButtonChromeState( title );

			expect( titleBeforeHover.backgroundColor ).toBe(
				'rgba(0, 0, 0, 0)'
			);
			expect( titleAfterHover.backgroundColor ).toBe(
				titleBeforeHover.backgroundColor
			);

			await title.hover();
			const menu = sidebar.getByRole( 'button', {
				name: `Actions for E2E Cog Chrome ${ suffix }`,
				exact: true,
			} );
			await menu.click();
			await expect( menu ).toHaveClass( /is-pressed/ );

			const menuBeforeHover = await readButtonChromeState( menu );
			await menu.hover();
			const menuAfterHover = await readButtonChromeState( menu );

			expect( menuBeforeHover.backgroundColor ).toBe(
				'rgba(0, 0, 0, 0)'
			);
			expect( menuAfterHover.backgroundColor ).toBe(
				menuBeforeHover.backgroundColor
			);
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

	test( 'arrow keys nudge width on the focused handle', async ( {
		page,
	} ) => {
		const handle = page.locator( '.cortext-sidebar__resize-handle' );
		await handle.focus();

		const startWidth = await readSidebarWidth( page );

		await page.keyboard.press( 'ArrowRight' );
		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeGreaterThan( startWidth );

		await page.keyboard.press( 'End' );
		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeGreaterThan( startWidth + 100 );

		await page.keyboard.press( 'Home' );
		await expect
			.poll( () => readSidebarWidth( page ) )
			.toBeLessThan( startWidth + 1 );
	} );

	test( 'keeps the rename input inside the page row height', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const title = `E2E Rename Geometry ${ suffix }`;
		const fixture = {};

		try {
			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title, status: 'private' },
			} );

			await admin.visitAdminPage(
				SHELL_PATH,
				`page=cortext&p=/page/${ fixture.page.id }`
			);

			const sidebar = page.locator( '.cortext-sidebar' );
			await sidebar
				.getByRole( 'button', { name: title, exact: true } )
				.hover();
			await sidebar
				.getByRole( 'button', {
					name: `Actions for ${ title }`,
					exact: true,
				} )
				.click();
			await page.getByRole( 'menuitem', { name: 'Rename' } ).click();

			await expect(
				page.locator( '.cortext-sidebar__rename input' )
			).toBeVisible();

			const geometry = await readRenameRowGeometry( page );
			expect( geometry ).not.toBeNull();
			expect( geometry.inputHeight ).toBeLessThanOrEqual(
				geometry.rowHeight
			);
			expect( geometry.overflowTop ).toBeLessThanOrEqual( 0 );
			expect( geometry.overflowBottom ).toBeLessThanOrEqual( 0 );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.page ? `/wp/v2/crtxt_pages/${ fixture.page.id }` : null
			);
		}
	} );
} );
