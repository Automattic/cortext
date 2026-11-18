/**
 * E2E tests for the lazy-loaded sidebar tree.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SHELL_PATH = 'admin.php';
const SHELL_QUERY = 'page=cortext';
const SUFFIX = Date.now().toString( 36 ).slice( -5 );
const ROOT_PREFIX = `E2E Lazy Root ${ SUFFIX }`;
const CHILD_PREFIX = `E2E Lazy Child ${ SUFFIX }`;
const PARENT_TITLE = `E2E Lazy Parent ${ SUFFIX }`;
const LAST_ROOT_TITLE = `${ ROOT_PREFIX } 100`;
const FIRST_CHILD_TITLE = `${ CHILD_PREFIX } 001`;
const LAST_CHILD_TITLE = `${ CHILD_PREFIX } 101`;

function numberedTitle( prefix, number ) {
	return `${ prefix } ${ String( number ).padStart( 3, '0' ) }`;
}

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
		const itemCount = await loadMoreButton.evaluate(
			( button ) => button.closest( 'ul' )?.children.length ?? 0
		);
		await loadMoreButton.evaluate( ( button ) => button.click() );
		// The REST request and React render are asynchronous. Wait for this
		// branch to gain another page before clicking the loading button again.
		await expect
			.poll( async () => {
				if ( await target.isVisible().catch( () => false ) ) {
					return true;
				}
				// The button goes away once the last page loads. Without a
				// short timeout, evaluate waits for it to come back and the
				// poll never rechecks the target.
				return loadMoreButton
					.evaluate(
						( button, previousCount ) =>
							( button.closest( 'ul' )?.children.length ?? 0 ) >
							previousCount,
						itemCount,
						{ timeout: 500 }
					)
					.catch( () => false );
			} )
			.toBe( true );
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

		const documents = [
			...Array.from( { length: 100 }, ( _, index ) => ( {
				title: numberedTitle( ROOT_PREFIX, index + 1 ),
				menu_order: -1000 + index + 1,
			} ) ),
			...Array.from( { length: 101 }, ( _, index ) => ( {
				title: numberedTitle( CHILD_PREFIX, index + 1 ),
				parent: parent.id,
				menu_order: -1000 + index + 1,
			} ) ),
		];
		const responses = await requestUtils.batchRest(
			documents.map( ( body ) => ( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				body: { status: 'private', ...body },
			} ) )
		);
		createdIds.push( ...responses.map( ( { body } ) => body.id ) );

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
		// The parent goes last, after its children are gone.
		const [ parentId, ...documentIds ] = createdIds;
		try {
			await requestUtils.batchRest(
				documentIds.map( ( id ) => ( {
					method: 'DELETE',
					path: `/wp/v2/crtxt_documents/${ id }?force=true`,
				} ) )
			);
		} catch {
			// Best-effort cleanup; some records may already be gone.
		}
		await deleteIfCreated( requestUtils, parentId );
	} );

	test( 'paginates root and child branches, then restores the open branch', async ( {
		admin,
		page,
	} ) => {
		// Open the parent so its children only show once the branch is
		// expanded; an open child would reveal them on its own.
		await admin.visitAdminPage(
			SHELL_PATH,
			`${ SHELL_QUERY }&p=/${ parent.id }`
		);
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

		await expect(
			page.getByRole( 'button', { name: FIRST_CHILD_TITLE, exact: true } )
		).toHaveCount( 0 );
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
