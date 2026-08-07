/**
 * Covers focus moving from the main sidebar into pages and collections opened
 * from the keyboard. Pointer navigation and browser history keep their usual
 * focus behavior.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const READY_TIMEOUT_MS = 15_000;
const SUFFIX = Date.now().toString( 36 ).slice( -5 );
const CANVAS_SELECTOR = 'iframe[name="editor-canvas"]';
const TITLE_BLOCK_SELECTOR = '[data-type="core/post-title"]';
const PARAGRAPH_BLOCK_SELECTOR = '[data-type="core/paragraph"]';

test.describe.configure( { mode: 'serial' } );

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
		// Ignore cleanup errors because the record may already be gone.
	}
}

async function deleteDocument( requestUtils, record ) {
	await deleteIfCreated(
		requestUtils,
		record?.id ? `/wp/v2/crtxt_documents/${ record.id }` : null
	);
}

async function createDocument( requestUtils, data ) {
	return requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			status: 'private',
			...data,
		},
	} );
}

async function createCollectionFixture( requestUtils, title, withRow ) {
	const collection = await createDocument( requestUtils, {
		title,
		cortext_collection: true,
	} );
	let row = null;

	if ( withRow ) {
		row = await createDocument( requestUtils, {
			title: `${ title } row`,
			content:
				'<!-- wp:paragraph --><p>Notes for this row.</p><!-- /wp:paragraph -->',
			cortext_trait: collection.id,
		} );
	}

	return { collection, row };
}

function documentUri( record ) {
	return record.slug
		? `${ record.slug }-${ record.id }`
		: String( record.id );
}

async function visitDocument( admin, page, record ) {
	await admin.visitAdminPage(
		'admin.php',
		`page=cortext&p=/${ documentUri( record ) }`
	);
	await waitForEditorPost( page, record.id );
}

async function waitForEditorPost( page, postId ) {
	await page.waitForFunction(
		( expectedPostId ) =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.() ===
			expectedPostId,
		postId,
		{ timeout: READY_TIMEOUT_MS }
	);
}

async function currentEditorPostId( page ) {
	return page.evaluate(
		() =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.() ?? 0
	);
}

function editorCanvas( page ) {
	return page.frameLocator( '[name="editor-canvas"]' );
}

async function canvasHasFocusWithin( page, selector ) {
	try {
		const outerHasCanvasFocus = await page
			.locator( 'body' )
			.evaluate(
				( body, canvasSelector ) =>
					body.ownerDocument.activeElement?.matches?.(
						canvasSelector
					) === true,
				CANVAS_SELECTOR
			);
		if ( ! outerHasCanvasFocus ) {
			return false;
		}

		return editorCanvas( page )
			.locator( selector )
			.first()
			.evaluate( ( target ) =>
				target.contains( target.ownerDocument.activeElement )
			);
	} catch ( error ) {
		if (
			/Frame was detached|Execution context was destroyed/.test(
				error?.message ?? ''
			)
		) {
			return false;
		}
		throw error;
	}
}

async function expectCanvasFocusWithin( page, selector ) {
	await expect(
		editorCanvas( page ).locator( selector ).first()
	).toBeVisible( { timeout: READY_TIMEOUT_MS } );
	await expect
		.poll( () => canvasHasFocusWithin( page, selector ), {
			timeout: READY_TIMEOUT_MS,
		} )
		.toBe( true );
}

async function expectCanvasControlFocused( page, selector ) {
	const control = editorCanvas( page ).locator( selector ).first();
	await expect( control ).toBeVisible( { timeout: READY_TIMEOUT_MS } );
	await expect
		.poll( () => canvasHasFocusWithin( page, selector ), {
			timeout: READY_TIMEOUT_MS,
		} )
		.toBe( true );
	await expect( control ).toBeFocused();
}

async function keyboardActivate( locator ) {
	await locator.focus();
	await expect( locator ).toBeFocused();
	await locator.press( 'Enter' );
}

async function expandSidebarSection( page, title ) {
	const expand = page
		.locator( '.cortext-sidebar' )
		.getByRole( 'button', { name: `Expand ${ title }`, exact: true } );
	if ( ( await expand.count() ) > 0 && ( await expand.isVisible() ) ) {
		await expand.click();
	}
}

function sidebarTreeButton( page, title ) {
	return page
		.locator( '[data-sidebar-section="pages"]' )
		.getByRole( 'button', { name: title, exact: true } );
}

test.describe( 'Sidebar surface focus', () => {
	test( 'keyboard activation from the tree and Home focuses empty and titled pages', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			fixture.parent = await createDocument( requestUtils, {
				title: `E2E Focus Parent ${ SUFFIX }`,
				menu_order: -2_100_000,
			} );
			fixture.untitled = await createDocument( requestUtils, {
				title: '',
				content: '',
				parent: fixture.parent.id,
				menu_order: -2_100_001,
			} );
			fixture.home = await createDocument( requestUtils, {
				title: `E2E Focus Home ${ SUFFIX }`,
				content:
					'<!-- wp:paragraph --><p>Welcome home.</p><!-- /wp:paragraph -->',
				menu_order: -2_100_002,
			} );
			await requestUtils.rest( {
				method: 'PUT',
				path: '/cortext/v1/workspace-home',
				data: { id: fixture.home.id },
			} );

			await visitDocument( admin, page, fixture.parent );
			await expandSidebarSection( page, 'Documents' );

			const parentNode = sidebarTreeButton(
				page,
				fixture.parent.title.rendered
			).locator(
				'xpath=ancestor::li[contains(@class,"cortext-sidebar__node")][1]'
			);
			const expandParent = parentNode.getByRole( 'button', {
				name: 'Expand',
				exact: true,
			} );
			if ( ( await expandParent.count() ) > 0 ) {
				await expandParent.click();
			}

			const untitled = parentNode.getByRole( 'button', {
				name: '(untitled)',
				exact: true,
			} );
			await expect( untitled ).toBeVisible();
			await keyboardActivate( untitled );
			await waitForEditorPost( page, fixture.untitled.id );
			await expectCanvasFocusWithin( page, TITLE_BLOCK_SELECTOR );

			// Pressing Enter again should move focus back into the open canvas.
			await keyboardActivate( untitled );
			await expectCanvasFocusWithin( page, TITLE_BLOCK_SELECTOR );

			const home = page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', { name: 'Home', exact: true } );
			await keyboardActivate( home );
			await waitForEditorPost( page, fixture.home.id );
			await expectCanvasFocusWithin( page, PARAGRAPH_BLOCK_SELECTOR );
		} finally {
			await deleteDocument( requestUtils, fixture.untitled );
			await deleteDocument( requestUtils, fixture.parent );
			await deleteDocument( requestUtils, fixture.home );
		}
	} );

	test( 'keyboard activation from Recents focuses a full-page row and a populated collection', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			Object.assign(
				fixture,
				await createCollectionFixture(
					requestUtils,
					`E2E Focus Recent Collection ${ SUFFIX }`,
					true
				)
			);

			// Visit the row and collection first so both appear in Recents.
			await visitDocument( admin, page, fixture.row );
			await visitDocument( admin, page, fixture.collection );
			await expect(
				editorCanvas( page ).locator( '.cortext-data-view' )
			).toBeVisible( { timeout: READY_TIMEOUT_MS } );
			await expandSidebarSection( page, 'Recents' );

			const sidebar = page.locator( '.cortext-sidebar' );
			const recentRow = sidebar.getByRole( 'button', {
				name: `Recent: ${ fixture.row.title.rendered } in ${ fixture.collection.title.rendered }`,
				exact: true,
			} );
			await expect( recentRow ).toBeVisible( {
				timeout: READY_TIMEOUT_MS,
			} );
			await keyboardActivate( recentRow );
			await waitForEditorPost( page, fixture.row.id );
			await expectCanvasFocusWithin( page, PARAGRAPH_BLOCK_SELECTOR );

			const recentCollection = sidebar.getByRole( 'button', {
				name: `Recent: ${ fixture.collection.title.rendered }`,
				exact: true,
			} );
			await expect( recentCollection ).toBeVisible( {
				timeout: READY_TIMEOUT_MS,
			} );
			await keyboardActivate( recentCollection );
			await waitForEditorPost( page, fixture.collection.id );
			await expectCanvasControlFocused(
				page,
				'.dataviews-search input[type="search"]'
			);
		} finally {
			await deleteDocument( requestUtils, fixture.row );
			await deleteDocument( requestUtils, fixture.collection );
		}
	} );

	test( 'keyboard activation from Favorites focuses pages and both populated and empty collections', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			fixture.neutral = await createDocument( requestUtils, {
				title: `E2E Focus Favorite Neutral ${ SUFFIX }`,
				menu_order: -2_100_020,
			} );
			fixture.page = await createDocument( requestUtils, {
				title: `E2E Focus Favorite Page ${ SUFFIX }`,
				content:
					'<!-- wp:paragraph --><p>Notes from a favorite page.</p><!-- /wp:paragraph -->',
				menu_order: -2_100_021,
			} );
			const populated = await createCollectionFixture(
				requestUtils,
				`E2E Focus Favorite Populated ${ SUFFIX }`,
				true
			);
			fixture.populatedCollection = populated.collection;
			fixture.populatedRow = populated.row;
			const empty = await createCollectionFixture(
				requestUtils,
				`E2E Focus Favorite Empty ${ SUFFIX }`,
				false
			);
			fixture.emptyCollection = empty.collection;

			await requestUtils.rest( {
				method: 'PUT',
				path: '/cortext/v1/favorites',
				data: {
					favorites: [
						{ id: fixture.page.id },
						{ id: fixture.populatedCollection.id },
						{ id: fixture.emptyCollection.id },
					],
				},
			} );

			await visitDocument( admin, page, fixture.neutral );
			await expandSidebarSection( page, 'Favorites' );
			const favorites = page.locator( '.cortext-sidebar__favorites' );

			const favoritePage = favorites.getByRole( 'button', {
				name: fixture.page.title.rendered,
				exact: true,
			} );
			await expect( favoritePage ).toBeVisible( {
				timeout: READY_TIMEOUT_MS,
			} );
			await keyboardActivate( favoritePage );
			await waitForEditorPost( page, fixture.page.id );
			await expectCanvasFocusWithin( page, PARAGRAPH_BLOCK_SELECTOR );

			const populatedCollection = favorites.getByRole( 'button', {
				name: fixture.populatedCollection.title.rendered,
				exact: true,
			} );
			await keyboardActivate( populatedCollection );
			await waitForEditorPost( page, fixture.populatedCollection.id );
			await expectCanvasControlFocused(
				page,
				'.dataviews-search input[type="search"]'
			);

			const emptyCollection = favorites.getByRole( 'button', {
				name: fixture.emptyCollection.title.rendered,
				exact: true,
			} );
			await keyboardActivate( emptyCollection );
			await waitForEditorPost( page, fixture.emptyCollection.id );
			await expectCanvasControlFocused(
				page,
				'.cortext-data-view__new-row'
			);
		} finally {
			try {
				await requestUtils.rest( {
					method: 'PUT',
					path: '/cortext/v1/favorites',
					data: { favorites: [] },
				} );
			} catch {
				// Keep deleting records even if clearing Favorites fails.
			}
			await deleteDocument( requestUtils, fixture.populatedRow );
			await deleteDocument( requestUtils, fixture.emptyCollection );
			await deleteDocument( requestUtils, fixture.populatedCollection );
			await deleteDocument( requestUtils, fixture.page );
			await deleteDocument( requestUtils, fixture.neutral );
		}
	} );

	test( 'pointer clicks, history navigation, and cancelled slow loads leave focus alone', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		let releaseDelayedDestination = () => {};

		try {
			fixture.first = await createDocument( requestUtils, {
				title: `E2E Focus History A ${ SUFFIX }`,
				content:
					'<!-- wp:paragraph --><p>First page in history.</p><!-- /wp:paragraph -->',
				menu_order: -2_100_030,
			} );
			fixture.second = await createDocument( requestUtils, {
				title: `E2E Focus History B ${ SUFFIX }`,
				content:
					'<!-- wp:paragraph --><p>Second page in history.</p><!-- /wp:paragraph -->',
				menu_order: -2_100_031,
			} );
			fixture.delayed = await createDocument( requestUtils, {
				title: `E2E Focus Delayed ${ SUFFIX }`,
				content:
					'<!-- wp:paragraph --><p>This page loads slowly.</p><!-- /wp:paragraph -->',
				menu_order: -2_100_032,
			} );

			await visitDocument( admin, page, fixture.first );
			await expandSidebarSection( page, 'Documents' );
			const second = sidebarTreeButton(
				page,
				fixture.second.title.rendered
			);
			await second.click();
			await waitForEditorPost( page, fixture.second.id );
			await expect( second ).toBeFocused();

			const focusSentinel = page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', {
					name: 'Collapse sidebar',
					exact: true,
				} );
			await focusSentinel.focus();
			await expect( focusSentinel ).toBeFocused();

			await page.goBack();
			await waitForEditorPost( page, fixture.first.id );
			await expect( focusSentinel ).toBeFocused();

			await page.goForward();
			await waitForEditorPost( page, fixture.second.id );
			await expect( focusSentinel ).toBeFocused();

			const delayedGate = new Promise( ( resolve ) => {
				releaseDelayedDestination = resolve;
			} );
			await page.route(
				`**/wp-json/cortext/v1/documents/${ fixture.delayed.id }**`,
				async ( route ) => {
					await delayedGate;
					await route.continue();
				}
			);
			const delayedRequest = page.waitForRequest( ( request ) =>
				request
					.url()
					.includes(
						`/wp-json/cortext/v1/documents/${ fixture.delayed.id }`
					)
			);

			const delayed = sidebarTreeButton(
				page,
				fixture.delayed.title.rendered
			);
			await keyboardActivate( delayed );
			await delayedRequest;

			// The page is still loading. Moving focus now cancels the request, so
			// the canvas must not take it back when loading finishes.
			await focusSentinel.focus();
			await expect( focusSentinel ).toBeFocused();
			releaseDelayedDestination();
			await waitForEditorPost( page, fixture.delayed.id );
			await expect( focusSentinel ).toBeFocused();
		} finally {
			releaseDelayedDestination();
			await deleteDocument( requestUtils, fixture.delayed );
			await deleteDocument( requestUtils, fixture.second );
			await deleteDocument( requestUtils, fixture.first );
		}
	} );

	test( 'creating or duplicating a document keeps the rename field focused', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			fixture.source = await createDocument( requestUtils, {
				title: `E2E Focus Duplicate Source ${ SUFFIX }`,
				menu_order: -2_100_040,
			} );
			await visitDocument( admin, page, fixture.source );
			await expandSidebarSection( page, 'Documents' );

			const newDocument = page
				.locator( '[data-sidebar-section="pages"]' )
				.getByRole( 'button', {
					name: 'New document',
					exact: true,
				} );
			await keyboardActivate( newDocument );

			const renameInput = page.locator(
				'.cortext-sidebar__rename input'
			);
			await expect( renameInput ).toBeVisible( {
				timeout: READY_TIMEOUT_MS,
			} );
			await expect( renameInput ).toBeFocused();
			await expect
				.poll(
					async () => {
						const postId = await currentEditorPostId( page );
						return postId > 0 && postId !== fixture.source.id
							? postId
							: 0;
					},
					{ timeout: READY_TIMEOUT_MS }
				)
				.toBeGreaterThan( 0 );
			fixture.createdId = await currentEditorPostId( page );
			expect( fixture.createdId ).toBeGreaterThan( 0 );

			await renameInput.press( 'Escape' );
			await visitDocument( admin, page, fixture.source );
			const sidebar = page.locator( '.cortext-sidebar' );
			const source = sidebarTreeButton(
				page,
				fixture.source.title.rendered
			);
			await source.hover();
			const actions = sidebar.getByRole( 'button', {
				name: `Actions for ${ fixture.source.title.rendered }`,
				exact: true,
			} );
			await actions.click();
			const duplicate = page.getByRole( 'menuitem', {
				name: /^Duplicate/,
			} );
			await expect( duplicate ).toBeVisible();
			const duplicateResponse = page.waitForResponse(
				( response ) =>
					response
						.url()
						.includes(
							`/cortext/v1/documents/${ fixture.source.id }/duplicate`
						) && response.request().method() === 'POST'
			);
			await duplicate.click();
			const duplicateRecord = await ( await duplicateResponse ).json();
			fixture.duplicateId = duplicateRecord.id;

			await expect( renameInput ).toBeVisible( {
				timeout: READY_TIMEOUT_MS,
			} );
			await expect( renameInput ).toBeFocused();
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.duplicateId
					? `/wp/v2/crtxt_documents/${ fixture.duplicateId }`
					: null
			);
			await deleteIfCreated(
				requestUtils,
				fixture.createdId
					? `/wp/v2/crtxt_documents/${ fixture.createdId }`
					: null
			);
			await deleteDocument( requestUtils, fixture.source );
		}
	} );
} );
