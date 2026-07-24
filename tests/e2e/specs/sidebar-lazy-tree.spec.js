/**
 * E2E tests for the lazy-loaded sidebar tree.
 */

const { test, expect } = require( '../test' );

const SHELL_PATH = 'admin.php';
const SHELL_QUERY = 'page=cortext';
const SUFFIX = Date.now().toString( 36 ).slice( -5 );
const ROOT_PREFIX = `E2E Lazy Root ${ SUFFIX }`;
const CHILD_PREFIX = `E2E Lazy Child ${ SUFFIX }`;
const PARENT_TITLE = `E2E Lazy Parent ${ SUFFIX }`;
const LAST_ROOT_TITLE = `${ ROOT_PREFIX } 100`;
const FIRST_CHILD_TITLE = `${ CHILD_PREFIX } 001`;
const LAST_CHILD_TITLE = `${ CHILD_PREFIX } 101`;

async function createDocument( requestUtils, title, args = {} ) {
	return requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			status: 'private',
			title,
			...args,
		},
	} );
}

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
		// Best-effort cleanup; the record may already be gone.
	}
}

function sidebarNodeByTitle( page, title ) {
	return page
		.locator( '.cortext-sidebar__node', {
			has: page.getByRole( 'button', { name: title, exact: true } ),
		} )
		.first();
}

async function expandSidebarNode( page, title ) {
	const node = sidebarNodeByTitle( page, title );
	await node.locator( '.cortext-sidebar__chevron' ).first().click();
}

async function loadMoreUntilVisible( target, loadMoreButton, maxClicks = 10 ) {
	for ( let clicks = 0; clicks < maxClicks; clicks++ ) {
		if ( await target.isVisible().catch( () => false ) ) {
			return;
		}
		await expect( loadMoreButton ).toBeVisible();
		await loadMoreButton.evaluate( ( button ) => button.click() );
	}
	await expect( target ).toBeVisible();
}

test.describe( 'Sidebar lazy tree', () => {
	test.setTimeout( 120_000 );

	let createdIds = [];
	let parent;

	test.beforeEach( async ( { requestUtils } ) => {
		createdIds = [];
		parent = await createDocument( requestUtils, PARENT_TITLE, {
			menu_order: -1000,
		} );
		createdIds.push( parent.id );

		for ( let i = 1; i <= 100; i++ ) {
			const root = await createDocument(
				requestUtils,
				`${ ROOT_PREFIX } ${ String( i ).padStart( 3, '0' ) }`,
				{ menu_order: -1000 + i }
			);
			createdIds.push( root.id );
		}

		for ( let i = 1; i <= 101; i++ ) {
			const child = await createDocument(
				requestUtils,
				`${ CHILD_PREFIX } ${ String( i ).padStart( 3, '0' ) }`,
				{
					parent: parent.id,
					menu_order: -1000 + i,
				}
			);
			createdIds.push( child.id );
		}

		await requestUtils.rest( {
			method: 'PUT',
			path: '/cortext/v1/sidebar-tree-preferences',
			data: { expanded: [] },
		} );
	} );

	test.afterEach( async ( { requestUtils } ) => {
		await requestUtils.rest( {
			method: 'PUT',
			path: '/cortext/v1/sidebar-tree-preferences',
			data: { expanded: [] },
		} );
		for ( const id of [ ...createdIds ].reverse() ) {
			await deleteIfCreated( requestUtils, id );
		}
	} );

	test( 'paginates root and child branches, then restores the open branch', async ( {
		admin,
		page,
	} ) => {
		await admin.visitAdminPage( SHELL_PATH, SHELL_QUERY );
		await expect( page.locator( '#cortext-sidebar' ) ).toBeVisible();

		await expect(
			page.getByRole( 'button', { name: PARENT_TITLE, exact: true } )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: LAST_ROOT_TITLE, exact: true } )
		).toHaveCount( 0 );

		await loadMoreUntilVisible(
			page.getByRole( 'button', { name: LAST_ROOT_TITLE, exact: true } ),
			page
				.locator(
					'#cortext-sidebar .cortext-sidebar__list > .cortext-sidebar__load-more-node'
				)
				.getByRole( 'button', { name: 'Show more' } )
		);

		await expandSidebarNode( page, PARENT_TITLE );

		await expect(
			page.getByRole( 'button', { name: FIRST_CHILD_TITLE, exact: true } )
		).toBeVisible();
		await expect(
			page.getByRole( 'button', { name: LAST_CHILD_TITLE, exact: true } )
		).toHaveCount( 0 );

		await loadMoreUntilVisible(
			page.getByRole( 'button', { name: LAST_CHILD_TITLE, exact: true } ),
			sidebarNodeByTitle( page, PARENT_TITLE ).getByRole( 'button', {
				name: 'Show more',
			} )
		);

		await page.reload();
		await expect(
			page.getByRole( 'button', { name: FIRST_CHILD_TITLE, exact: true } )
		).toBeVisible();
	} );
} );
