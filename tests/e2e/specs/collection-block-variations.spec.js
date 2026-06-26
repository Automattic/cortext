/**
 * E2E coverage for the two `cortext/data-view` inserter variations. Each stamps
 * a transient `intent` attribute; the block reads it once to open the
 * placeholder straight into create or link mode, then clears it so saved blocks
 * only ever carry `collectionId` + `view`.
 *
 * The variations are inserted by writing the `intent` into the block markup,
 * which is exactly what `registerBlockVariation` produces on insert. The
 * registration itself (two entries, create is the default) is unit-tested in
 * tests/js/blocks/data-view-variations.test.js.
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

function dataViewTableRow( canvas, title ) {
	return canvas.locator( '.dataviews-view-table tbody tr' ).filter( {
		hasText: title,
	} );
}

async function createCollectionFixture( requestUtils ) {
	const suffix = Date.now().toString( 36 ).slice( -4 );

	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: { title: `E2E Books ${ suffix }`, status: 'private' },
	} );
	const field = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_fields',
		data: { title: 'Author', status: 'private', meta: { type: 'text' } },
	} );
	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/crtxt_documents/${ collection.id }`,
		data: { meta: { cortext_fields: [ String( field.id ) ] } },
	} );
	const entry = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			title: 'The Left Hand of Darkness',
			status: 'private',
			cortext_trait: collection.id,
			meta: { [ `field-${ field.id }` ]: 'Ursula K. Le Guin' },
		},
	} );

	return { collection, field, entry };
}

async function createPageWithBlock( requestUtils, title, intent ) {
	return requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			title,
			status: 'private',
			content: `<!-- wp:cortext/data-view {"intent":"${ intent }"} /-->`,
		},
	} );
}

async function openDocument( admin, page, postId ) {
	await admin.visitAdminPage( 'admin.php', `page=cortext&p=/${ postId }` );
	await page.waitForFunction(
		( id ) =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.() ===
			id,
		postId,
		{ timeout: 15_000 }
	);
}

async function dataViewCollectionId( page ) {
	return page.evaluate( () => {
		const block = window.wp.data
			.select( 'core/block-editor' )
			.getBlocks()
			.find( ( item ) => item.name === 'cortext/data-view' );
		return block?.attributes?.collectionId ?? 0;
	} );
}

async function savePost( page ) {
	await page.evaluate( async () => {
		await window.wp.data.dispatch( 'core/editor' ).savePost();
	} );
	await page.waitForFunction(
		() => ! window.wp.data.select( 'core/editor' ).isSavingPost()
	);
}

test.describe( 'Collection block creation variations', () => {
	test( 'the create variation names a new collection and drops the transient intent', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			fixture.page = await createPageWithBlock(
				requestUtils,
				'Inline create variation',
				'create-inline'
			);

			await openDocument( admin, page, fixture.page.id );

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			// Create mode: the name form, not the picker.
			await expect( canvas.getByLabel( 'Name' ) ).toBeVisible();
			await expect(
				canvas.getByPlaceholder( 'Search collections' )
			).toHaveCount( 0 );

			await canvas.getByLabel( 'Name' ).fill( 'Inline Variation Books' );
			await canvas
				.getByRole( 'button', { name: 'Create collection' } )
				.click();

			await expect( canvas.locator( '.cortext-data-view' ) ).toBeVisible(
				{ timeout: 15_000 }
			);

			fixture.createdCollectionId = await dataViewCollectionId( page );
			expect( fixture.createdCollectionId ).toBeGreaterThan( 0 );

			await savePost( page );

			const saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_documents/${ fixture.page.id }`,
				params: { context: 'edit' },
			} );
			expect( saved.content.raw ).toContain(
				`"collectionId":${ fixture.createdCollectionId }`
			);
			expect( saved.content.raw ).not.toContain( '"intent"' );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_documents/${ fixture.page.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.createdCollectionId &&
					`/wp/v2/crtxt_documents/${ fixture.createdCollectionId }`
			);
		}
	} );

	test( 'the linked variation shows the searchable picker and binds an existing collection', async ( {
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
			fixture.page = await createPageWithBlock(
				requestUtils,
				'Inline link variation',
				'link-existing'
			);

			await openDocument( admin, page, fixture.page.id );

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			// Link mode: the searchable picker, not the name form.
			await expect(
				canvas.getByPlaceholder( 'Search collections' )
			).toBeVisible();
			await expect( canvas.getByLabel( 'Name' ) ).toHaveCount( 0 );

			await canvas.getByRole( 'button', { name: /E2E Books/ } ).click();

			await expect(
				dataViewTableRow( canvas, 'The Left Hand of Darkness' )
			).toBeVisible();

			await savePost( page );

			const saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_documents/${ fixture.page.id }`,
				params: { context: 'edit' },
			} );
			expect( saved.content.raw ).toContain(
				`"collectionId":${ fixture.collection.id }`
			);
			expect( saved.content.raw ).not.toContain( '"intent"' );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_documents/${ fixture.page.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.entry && `/wp/v2/crtxt_documents/${ fixture.entry.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.field && `/wp/v2/crtxt_fields/${ fixture.field.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_documents/${ fixture.collection.id }`
			);
		}
	} );
} );
