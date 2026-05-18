/**
 * E2E coverage for the per-user sidebar Recents list.
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
		// Best-effort cleanup; the record may already be gone.
	}
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

async function appPath( page ) {
	return page.evaluate(
		() => new URL( window.location.href ).searchParams.get( 'p' ) || '/'
	);
}

async function readRecentsPlacement( page ) {
	return page.evaluate( () => {
		const titles = Array.from(
			document.querySelectorAll( '.cortext-sidebar__section-title' )
		).map( ( title ) => title.textContent.trim() );
		return {
			recents: titles.indexOf( 'Recents' ),
			pages: titles.indexOf( 'Pages' ),
		};
	} );
}

async function clearSidebarSectionPrefs( page ) {
	await page.evaluate( () => {
		try {
			window.localStorage.removeItem(
				'cortext.sidebarSectionsCollapsed'
			);
		} catch {}
	} );
}

async function expandRecentsIfCollapsed( page ) {
	const sidebar = page.locator( '.cortext-sidebar' );
	const expandRecents = sidebar.getByRole( 'button', {
		name: 'Expand Recents',
	} );

	if ( await expandRecents.count() ) {
		await expandRecents.click();
	}
}

async function createCollectionFixture( requestUtils ) {
	const suffix = Date.now().toString( 36 ).slice( -4 );
	const slug = `e2erec${ suffix }`;
	const collectionTitle = `E2E Recent Rows ${ suffix }`;

	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_collections',
		data: {
			title: collectionTitle,
			status: 'private',
			meta: { slug },
		},
	} );

	const field = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_fields',
		data: {
			title: 'Author',
			status: 'private',
			meta: { type: 'text' },
		},
	} );

	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/crtxt_collections/${ collection.id }`,
		data: {
			meta: { fields: [ String( field.id ) ] },
		},
	} );

	const entry = await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/crtxt_${ slug }`,
		data: {
			title: 'The Left Hand of Darkness',
			status: 'private',
			meta: {
				[ `field-${ field.id }` ]: 'Ursula K. Le Guin',
			},
		},
	} );

	return { collection, collectionTitle, field, entry, slug };
}

function createDataViewBlockMarkup( collectionId ) {
	const attributes = {
		collectionId,
		view: {
			type: 'table',
			fields: [],
			sort: null,
			filters: [],
			calculations: {},
			perPage: 25,
			page: 1,
			search: '',
			layout: {},
		},
	};

	return `<!-- wp:cortext/data-view ${ JSON.stringify( attributes ) } /-->`;
}

test.describe( 'Sidebar recents', () => {
	test( 'records page and collection visits above Pages and persists after reload', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const pageTitle = `E2E Recent Page ${ suffix }`;
		const collectionTitle = `E2E Recent Collection ${ suffix }`;
		let recentPage;
		let collection;

		try {
			recentPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: pageTitle,
					status: 'private',
				},
			} );
			collection = await requestUtils.rest( {
				method: 'POST',
				path: '/cortext/v1/collections',
				data: { title: collectionTitle },
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/page/${ recentPage.id }`
			);
			await clearSidebarSectionPrefs( page );
			await page.reload();
			await waitForEditorPost( page, recentPage.id );

			const sidebar = page.locator( '.cortext-sidebar' );
			await expect(
				sidebar.getByRole( 'button', { name: 'Expand Recents' } )
			).toBeVisible();
			await expandRecentsIfCollapsed( page );
			await expect(
				sidebar.getByRole( 'button', {
					name: `Recent page: ${ pageTitle }`,
				} )
			).toBeVisible();

			const placement = await readRecentsPlacement( page );
			expect( placement.recents ).toBeGreaterThanOrEqual( 0 );
			expect( placement.pages ).toBeGreaterThan( placement.recents );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/collection/${ collection.slug }-${ collection.id }`
			);
			await expect(
				page.locator(
					'.cortext-workspace__pane[data-active="true"] .cortext-data-view'
				)
			).toBeVisible( { timeout: 15_000 } );
			await expect(
				sidebar.getByRole( 'button', {
					name: `Recent collection: ${ collectionTitle }`,
				} )
			).toBeVisible();

			await page.reload();
			await expect(
				sidebar.getByRole( 'button', {
					name: `Recent collection: ${ collectionTitle }`,
				} )
			).toBeVisible();
			await expect(
				sidebar.getByRole( 'button', {
					name: `Recent page: ${ pageTitle }`,
				} )
			).toBeVisible();
		} finally {
			await deleteIfCreated(
				requestUtils,
				collection && `/wp/v2/crtxt_collections/${ collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				recentPage && `/wp/v2/crtxt_pages/${ recentPage.id }`
			);
		}
	} );

	test( 'records row edits and row recents open the row', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			Object.assign(
				fixture,
				await createCollectionFixture( requestUtils )
			);

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Row recent test page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id ),
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/page/${ fixture.page.id }`
			);
			await waitForEditorPost( page, fixture.page.id );

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			const cell = canvas.getByText( 'Ursula K. Le Guin', {
				exact: true,
			} );
			await expect( cell ).toBeVisible();
			await cell.click();

			const input = canvas.getByRole( 'textbox', {
				name: 'Author',
				exact: true,
			} );
			await input.fill( 'U. K. Le Guin' );
			await input.press( 'Enter' );

			await expect
				.poll( async () => {
					const row = await requestUtils.rest( {
						path: `/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`,
						params: { context: 'edit' },
					} );
					return row.meta[ `field-${ fixture.field.id }` ];
				} )
				.toBe( 'U. K. Le Guin' );

			const sidebar = page.locator( '.cortext-sidebar' );
			await expandRecentsIfCollapsed( page );
			const recentRow = sidebar.getByRole( 'button', {
				name: `Recent row: The Left Hand of Darkness in ${ fixture.collectionTitle }`,
			} );
			await expect( recentRow ).toBeVisible( { timeout: 15_000 } );

			await recentRow.click();

			await expect
				.poll( () => appPath( page ) )
				.toContain( `/${ fixture.entry.slug }-${ fixture.entry.id }` );
			await expect(
				page.locator(
					'.cortext-workspace__pane[data-active="true"] .cortext-row-detail__frame'
				)
			).toBeVisible( { timeout: 15_000 } );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.entry &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_pages/${ fixture.page.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.field && `/wp/v2/crtxt_fields/${ fixture.field.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );
} );
