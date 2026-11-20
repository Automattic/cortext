/**
 * Smoke test for the Cortext wp-admin shell page.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

test.describe( 'Cortext shell', () => {
	test( 'admin reaches the shell via the admin menu', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=cortext' );

		await expect( page ).toHaveURL(
			/\/wp-admin\/admin\.php\?page=cortext(?:&p=.*)?$/
		);

		const root = page.locator( '#cortext-root' );
		await expect( root ).toBeVisible();
		// Assert React actually mounted content, not just the empty container.
		await expect( root.locator( ':scope > *' ).first() ).toBeVisible( {
			timeout: 15_000,
		} );
	} );
} );
