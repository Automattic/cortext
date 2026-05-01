/**
 * E2E tests for public page rendering.
 *
 * A published crtxt_page should be reachable at /cortext/{slug}/ by an
 * unauthenticated visitor; a private page should 404.
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
		// Best-effort cleanup.
	}
}

test.describe( 'Public page rendering', () => {
	test( 'published page is accessible to anonymous visitors', async ( {
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const title = `Public page ${ suffix }`;
		const bodyText = `Hello from a public Cortext page ${ suffix }`;
		let createdPage;

		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title,
					status: 'publish',
					content: `<!-- wp:paragraph -->\n<p>${ bodyText }</p>\n<!-- /wp:paragraph -->`,
				},
			} );

			await page.context().clearCookies( { name: /^wordpress_/ } );

			const response = await page.goto(
				`/cortext/${ createdPage.slug }/`
			);

			expect( response?.status() ).toBe( 200 );
			await expect( page.locator( 'h1' ) ).toHaveText( title );
			await expect(
				page.locator( 'p' ).getByText( bodyText )
			).toBeVisible();
		} finally {
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_pages/${ createdPage.id }`
			);
		}
	} );

	test( 'private page returns 404 for anonymous visitors', async ( {
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		let createdPage;

		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: `Private page ${ suffix }`,
					status: 'private',
				},
			} );

			await page.context().clearCookies( { name: /^wordpress_/ } );

			const response = await page.goto(
				`/cortext/${ createdPage.slug }/`
			);

			expect( response?.status() ).toBe( 404 );
		} finally {
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_pages/${ createdPage.id }`
			);
		}
	} );
} );
