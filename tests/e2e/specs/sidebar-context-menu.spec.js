/**
 * E2E coverage for opening sidebar document actions with right-click.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const TITLE = `E2E Context Menu ${ SUFFIX }`;

test.describe( 'Sidebar context menu', () => {
	let documentId;

	test.beforeEach( async ( { requestUtils } ) => {
		const created = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/crtxt_documents',
			data: { title: TITLE, status: 'private' },
		} );
		documentId = created.id;
	} );

	test.afterEach( async ( { requestUtils } ) => {
		try {
			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/crtxt_documents/${ documentId }`,
				params: { force: true },
			} );
		} catch {
			// Best-effort cleanup; the record may already be gone.
		}
	} );

	test( 'right-click opens the actions menu at the cursor', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=cortext' );
		const title = page
			.locator( '.cortext-sidebar' )
			.getByRole( 'button', { name: TITLE, exact: true } );
		await expect( title ).toBeVisible();

		const box = await title.boundingBox();
		const x = box.x + box.width / 2;
		const y = box.y + box.height / 2;
		await page.mouse.click( x, y, { button: 'right' } );

		const menu = page.locator( '.components-dropdown__content' );
		await expect(
			menu.getByRole( 'menuitem', { name: 'Duplicate' } )
		).toBeVisible();
		await expect(
			menu.getByRole( 'menuitem', { name: 'Move to Trash' } )
		).toBeVisible();

		const menuBox = await menu.boundingBox();
		expect( Math.abs( menuBox.x - x ) ).toBeLessThan( 24 );
		expect( Math.abs( menuBox.y - y ) ).toBeLessThan( 24 );

		// A right-click inside the open menu leaves it where it is.
		await menu
			.getByRole( 'menuitem', { name: 'Duplicate' } )
			.click( { button: 'right' } );
		await expect( menu ).toBeVisible();
		expect( await menu.boundingBox() ).toEqual( menuBox );

		await page.keyboard.press( 'Escape' );
		await expect( menu ).toBeHidden();
	} );

	test( 'right-click while renaming keeps the browser menu', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=cortext' );
		const sidebar = page.locator( '.cortext-sidebar' );
		await sidebar
			.getByRole( 'button', { name: TITLE, exact: true } )
			.hover();
		await sidebar
			.getByRole( 'button', {
				name: `Actions for ${ TITLE }`,
				exact: true,
			} )
			.click( { force: true } );
		await page.getByRole( 'menuitem', { name: 'Rename' } ).click();

		const input = sidebar.locator( '.cortext-sidebar__rename input' );
		await expect( input ).toBeFocused();

		const prevented = await input.evaluate( ( element ) => {
			const event = new element.ownerDocument.defaultView.MouseEvent(
				'contextmenu',
				{
					bubbles: true,
					cancelable: true,
					clientX: 10,
					clientY: 10,
				}
			);
			element.dispatchEvent( event );
			return event.defaultPrevented;
		} );
		expect( prevented ).toBe( false );
		await expect(
			page.getByRole( 'menuitem', { name: 'Duplicate' } )
		).toBeHidden();

		await page.keyboard.press( 'Escape' );
	} );
} );
