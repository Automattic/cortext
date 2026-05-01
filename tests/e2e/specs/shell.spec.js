/**
 * Smoke tests for the Cortext wp-admin shell page.
 *
 * The shell is registered via add_menu_page() in Cortext\Admin\Screen, so the
 * three behaviors we care about are enforced by wp-admin itself:
 *   1. User with edit_posts → page renders with #cortext-root mounted.
 *   2. Anonymous user → auth_redirect to wp-login.php.
 *   3. Logged-in user without edit_posts → wp_die with 403.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const { withExpectedConsoleError } = require( '../utils' );

const SHELL_PATH = '/wp-admin/admin.php?page=cortext';

test.describe( 'Cortext shell', () => {
	test( 'admin reaches the shell via the admin menu', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( 'admin.php', 'page=cortext' );

		await expect( page ).toHaveURL(
			/\/wp-admin\/admin\.php\?page=cortext$/
		);

		const root = page.locator( '#cortext-root' );
		await expect( root ).toBeVisible();
		// Assert React actually mounted content, not just the empty container.
		await expect( root.locator( ':scope > *' ).first() ).toBeVisible( {
			timeout: 15_000,
		} );
	} );

	test( 'anonymous visitor is redirected to login', async ( { page } ) => {
		// Keep Playground's `playground_auto_login_already_happened` cookie
		// intact so the `--login` mu-plugin doesn't silently log us back in
		// as admin when WP auth cookies are cleared.
		await page.context().clearCookies( { name: /^wordpress_/ } );

		await page.goto( SHELL_PATH );

		await expect( page ).toHaveURL( /wp-login\.php/ );
	} );

	test( 'user without edit_posts gets 403', async ( {
		page,
		requestUtils,
	} ) => {
		const user = await requestUtils.createUser( {
			username: 'cortext-subscriber',
			email: 'cortext-subscriber@example.test',
			password: 'cortext-sub-password',
			roles: [ 'subscriber' ],
		} );

		await withExpectedConsoleError(
			/the server responded with a status of 403/,
			async () => {
				try {
					// Keep Playground's `playground_auto_login_already_happened` cookie
					// intact so the `--login` mu-plugin doesn't silently log us back in
					// as admin when WP auth cookies are cleared.
					await page
						.context()
						.clearCookies( { name: /^wordpress_/ } );

					await page.request.post( '/wp-login.php', {
						failOnStatusCode: true,
						form: {
							log: 'cortext-subscriber',
							pwd: 'cortext-sub-password',
						},
					} );
					const response = await page.goto( SHELL_PATH );

					expect( response?.status() ).toBe( 403 );
				} finally {
					await requestUtils.rest( {
						method: 'DELETE',
						path: `/wp/v2/users/${ user.id }`,
						params: { force: true, reassign: 1 },
					} );
				}
			}
		);
	} );
} );
