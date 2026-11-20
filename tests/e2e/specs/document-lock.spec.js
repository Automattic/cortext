/**
 * E2E coverage for locking a page.
 *
 * Locks a page from the sidebar menu, checks the Locked indicator and that
 * neither the editor nor REST can change it, then unlocks it and edits again.
 * Also checks that a locked row shows its lock in tables and the row detail
 * without changing the row's height.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const PAGE_TITLE = `E2E Lock ${ SUFFIX }`;

async function openSidebarMenuItem( page, title, item ) {
	const sidebar = page.locator( '.cortext-sidebar' );
	const rowTitle = sidebar.getByRole( 'button', {
		name: title,
		exact: true,
	} );
	await rowTitle.hover();
	// The row's drop-zone overlays sit on top of the menu trigger in stacking
	// order, so skip Playwright's actionability check.
	await sidebar
		.getByRole( 'button', { name: `Actions for ${ title }`, exact: true } )
		.click( { force: true } );
	await page.getByRole( 'menuitem', { name: item, exact: true } ).click();
}

test.describe( 'Document lock', () => {
	test( 'a locked page cannot be edited until it is unlocked', async ( {
		admin,
		editor,
		page,
		requestUtils,
	} ) => {
		let doc;

		try {
			doc = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: PAGE_TITLE,
					status: 'private',
					content:
						'<!-- wp:paragraph --><p>Keep this text</p><!-- /wp:paragraph -->',
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ doc.id }`
			);
			await page.waitForFunction(
				( postId ) =>
					window.wp?.data
						?.select( 'core/editor' )
						?.getCurrentPostId?.() === postId,
				doc.id,
				{ timeout: 15_000 }
			);

			await openSidebarMenuItem( page, PAGE_TITLE, 'Lock' );

			await expect(
				page.locator( '.components-snackbar' ).filter( {
					hasText: 'Document locked.',
				} )
			).toBeVisible();
			await expect(
				page.locator( '.cortext-breadcrumbs .cortext-frozen-badge' )
			).toContainText( 'Locked' );
			await expect(
				page.locator( '.cortext-sidebar .cortext-frozen-badge' )
			).toBeVisible();

			const title = editor.canvas.locator( '.wp-block-post-title' );
			await title.click( { force: true } );
			await page.keyboard.type( 'XYZ' );
			await expect( title ).toHaveText( PAGE_TITLE );

			await expect(
				requestUtils.rest( {
					method: 'POST',
					path: `/wp/v2/crtxt_documents/${ doc.id }`,
					data: { title: 'Changed while locked' },
				} )
			).rejects.toMatchObject( { code: 'cortext_document_frozen' } );

			await openSidebarMenuItem( page, PAGE_TITLE, 'Unlock' );
			await expect(
				page.locator( '.cortext-breadcrumbs .cortext-frozen-badge' )
			).toHaveCount( 0 );

			const unlocked = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_documents/${ doc.id }`,
				data: { title: `${ PAGE_TITLE } edited` },
			} );
			expect( unlocked.title.raw ).toBe( `${ PAGE_TITLE } edited` );
			expect( unlocked.content.raw ).toContain( 'Keep this text' );
		} finally {
			if ( doc?.id ) {
				await requestUtils
					.rest( {
						method: 'DELETE',
						path: `/wp/v2/crtxt_documents/${ doc.id }`,
						params: { force: true },
					} )
					.catch( () => {} );
			}
		}
	} );

	test( 'a locked row keeps its height and shows its lock in the table and the detail', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const created = [];
		const createDoc = async ( path, data ) => {
			const record = await requestUtils.rest( {
				method: 'POST',
				path,
				data: { status: 'private', ...data },
			} );
			created.push( { path, id: record.id } );
			return record;
		};

		try {
			const collection = await createDoc( '/wp/v2/crtxt_documents', {
				title: `E2E Lock Rows ${ SUFFIX }`,
			} );
			const field = await requestUtils.rest( {
				method: 'POST',
				path: `/cortext/v1/collections/${ collection.id }/fields`,
				data: { title: 'Author', type: 'text' },
			} );
			created.push( { path: '/wp/v2/crtxt_fields', id: field.id } );
			// The last row lacks a bottom border, so lock a middle row and
			// compare it with the first.
			for ( const title of [ 'Open row', 'Locked row', 'Last row' ] ) {
				await createDoc( '/wp/v2/crtxt_documents', {
					title,
					cortext_trait: collection.id,
					meta: { [ `field-${ field.id }` ]: 'Someone' },
				} );
			}
			const lockedRowId = created.at( -2 ).id;
			await requestUtils.rest( {
				method: 'POST',
				path: `/cortext/v1/documents/${ lockedRowId }/freeze`,
			} );
			const host = await createDoc( '/wp/v2/crtxt_documents', {
				title: `E2E Lock Rows Page ${ SUFFIX }`,
				content: `<!-- wp:cortext/data-view ${ JSON.stringify( {
					collectionId: collection.id,
					view: { type: 'table', fields: [], perPage: 25, page: 1 },
				} ) } /-->`,
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ host.id }`
			);
			const canvas = page
				.getByRole( 'region', { name: 'Content' } )
				.frameLocator( 'iframe[name="editor-canvas"]' );
			const rowFor = ( title ) =>
				canvas
					.locator( '.cortext-data-view tbody tr' )
					.filter( { hasText: title } );
			const lockedRow = rowFor( 'Locked row' );
			const openRow = rowFor( 'Open row' );
			await expect( lockedRow ).toBeVisible( { timeout: 15_000 } );
			await expect( openRow ).toBeVisible();

			await expect(
				lockedRow.locator( '.cortext-title-cell .cortext-frozen-badge' )
			).toBeVisible();
			await expect(
				openRow.locator( '.cortext-frozen-badge' )
			).toHaveCount( 0 );

			const lockedBox = await lockedRow.boundingBox();
			const openBox = await openRow.boundingBox();
			expect( lockedBox.height ).toBe( openBox.height );

			await lockedRow.hover();
			await lockedRow.locator( '.cortext-title-cell__open' ).click();
			await expect(
				page.locator(
					'.cortext-row-detail__toolbar .cortext-frozen-badge'
				)
			).toContainText( 'Locked' );
		} finally {
			for ( const { path, id } of created.reverse() ) {
				await requestUtils
					.rest( {
						method: 'DELETE',
						path: `${ path }/${ id }`,
						params: { force: true },
					} )
					.catch( () => {} );
			}
		}
	} );
} );
