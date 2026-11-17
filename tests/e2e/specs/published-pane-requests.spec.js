/**
 * E2E coverage for when the Published list is requested.
 *
 * The pane stays mounted on every route, so only the network can show that its
 * list waits until the pane is open and stays quiet while pages save elsewhere.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const DRAFT_TITLE = `E2E Published Requests Draft ${ SUFFIX }`;
const PUBLIC_TITLE = `E2E Published Requests Public ${ SUFFIX }`;

async function deleteIfCreated( requestUtils, id ) {
	if ( ! id ) {
		return;
	}
	try {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/crtxt_documents/${ id }`,
			params: { force: true },
		} );
	} catch {
		// Best-effort cleanup.
	}
}

function documentListStatus( request ) {
	const url = new URL( request.url() );
	const route = url.searchParams.get( 'rest_route' ) ?? url.pathname;
	if (
		request.method() !== 'GET' ||
		! route.endsWith( '/crtxt_documents' )
	) {
		return null;
	}
	// The workspace tree sends `status[]`, so a plain `status` is this list.
	return url.searchParams.get( 'status' ) ?? 'other';
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

// Edits the open page and waits for the autosave plus the list refetches that
// follow it, so a Published request would have had its chance to go out.
async function editAndAutosave( page, requests, postId, title ) {
	const listRequestsBefore = requests.lists;
	const saved = page.waitForResponse(
		( response ) =>
			response.request().method() !== 'GET' &&
			response.url().includes( `crtxt_documents/${ postId }` ),
		{ timeout: 15_000 }
	);
	await page.evaluate(
		( nextTitle ) =>
			window.wp.data
				.dispatch( 'core/editor' )
				.editPost( { title: nextTitle } ),
		title
	);
	await saved;
	await expect
		.poll( () => requests.lists, { timeout: 15_000 } )
		.toBeGreaterThan( listRequestsBefore );
}

test.describe( 'Published list requests', () => {
	test( 'loads the list only while the Published pane is open', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let draft;
		let published;
		const requests = { lists: 0, published: 0 };
		page.on( 'request', ( request ) => {
			const status = documentListStatus( request );
			if ( status === null ) {
				return;
			}
			requests.lists += 1;
			if ( status === 'publish' ) {
				requests.published += 1;
			}
		} );

		try {
			draft = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: { title: DRAFT_TITLE, status: 'private' },
			} );
			published = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: { title: PUBLIC_TITLE, status: 'publish' },
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ draft.id }`
			);
			await waitForEditorPost( page, draft.id );
			await editAndAutosave(
				page,
				requests,
				draft.id,
				`${ DRAFT_TITLE } edited`
			);
			expect( requests.published ).toBe( 0 );

			const sidebar = page.locator( '.cortext-sidebar' );
			const pane = page.locator( '.cortext-published-pane' );
			await sidebar.getByRole( 'button', { name: 'Settings' } ).click();
			await sidebar
				.getByRole( 'button', { name: 'Published', exact: true } )
				.click();
			await expect(
				pane.getByRole( 'button', { name: PUBLIC_TITLE } )
			).toBeVisible();
			expect( requests.published ).toBe( 1 );

			// Nothing was saved in between, so coming back reuses the list.
			await sidebar
				.getByRole( 'button', { name: 'Import', exact: true } )
				.click();
			await sidebar
				.getByRole( 'button', { name: 'Published', exact: true } )
				.click();
			await expect(
				pane.getByRole( 'button', { name: PUBLIC_TITLE } )
			).toBeVisible();
			expect( requests.published ).toBe( 1 );

			// A save elsewhere leaves the list alone until the pane is reopened.
			await sidebar
				.getByRole( 'button', { name: 'Back', exact: true } )
				.click();
			await expect(
				page.locator( '.cortext-workspace__pane[data-active="true"]' )
			).toHaveAttribute( 'data-preserve-paint', 'true' );
			await editAndAutosave(
				page,
				requests,
				draft.id,
				`${ DRAFT_TITLE } edited again`
			);
			expect( requests.published ).toBe( 1 );

			await sidebar.getByRole( 'button', { name: 'Settings' } ).click();
			await sidebar
				.getByRole( 'button', { name: 'Published', exact: true } )
				.click();
			await expect
				.poll( () => requests.published, { timeout: 15_000 } )
				.toBe( 2 );
			await expect(
				pane.getByRole( 'button', { name: PUBLIC_TITLE } )
			).toBeVisible();
		} finally {
			await deleteIfCreated( requestUtils, draft?.id );
			await deleteIfCreated( requestUtils, published?.id );
		}
	} );
} );
