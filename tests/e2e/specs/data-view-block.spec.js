/**
 * E2E coverage for the Cortext collection DataView block in the shell editor.
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
	} catch ( _error ) {
		// Best-effort cleanup; failures here should not mask the test result.
	}
}

async function createCollectionFixture( requestUtils ) {
	const suffix = Date.now().toString( 36 ).slice( -4 );
	const slug = `e2ebooks${ suffix }`;

	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_collections',
		data: {
			title: `E2E Books ${ suffix }`,
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

	return { collection, field, entry, slug };
}

function createDataViewBlockMarkup( collectionId ) {
	const attributes = {
		collectionId,
		view: {
			type: 'table',
			fields: [],
			sort: null,
			filters: [],
			perPage: 25,
			page: 1,
			search: '',
			layout: {},
		},
	};

	return `<!-- wp:cortext/data-view ${ JSON.stringify( attributes ) } /-->`;
}

function createEmptyDataViewBlockMarkup() {
	return '<!-- wp:cortext/data-view /-->';
}

function parseCollectionIdFromContent( content ) {
	const match = content.match( /"collectionId":(\d+)/ );
	return match ? Number( match[ 1 ] ) : 0;
}

test.describe( 'Collection view block', () => {
	test( 'renders a selected collection and persists block attributes', async ( {
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
					title: 'DataView block test page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id ),
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/page/${ fixture.page.id }`
			);

			await page.waitForFunction(
				( postId ) =>
					window.wp?.data
						?.select( 'core/editor' )
						?.getCurrentPostId?.() === postId,
				fixture.page.id,
				{ timeout: 15_000 }
			);

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			await expect( canvas.getByText( 'Title' ) ).toBeVisible();
			await expect( canvas.getByText( 'Author' ) ).toBeVisible();
			await expect(
				canvas.getByText( 'The Left Hand of Darkness' )
			).toBeVisible();
			await expect(
				canvas.getByText( 'Ursula K. Le Guin' )
			).toBeVisible();

			await page.evaluate( async () => {
				await window.wp.data.dispatch( 'core/editor' ).savePost();
			} );
			await page.waitForFunction(
				() => ! window.wp.data.select( 'core/editor' ).isSavingPost()
			);

			const saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_pages/${ fixture.page.id }`,
				params: { context: 'edit' },
			} );
			expect( saved.content.raw ).toContain( 'wp:cortext/data-view' );
			expect( saved.content.raw ).toContain(
				`"collectionId":${ fixture.collection.id }`
			);
			expect( saved.content.raw ).toContain(
				`"field-${ fixture.field.id }"`
			);

			await page.reload();
			await expect(
				canvas.getByText( 'The Left Hand of Darkness' )
			).toBeVisible();
			await expect(
				canvas.getByText( 'Ursula K. Le Guin' )
			).toBeVisible();
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

	test( 'creates a collection from the placeholder and can switch collections', async ( {
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
					title: 'Inline collection creation page',
					status: 'private',
					content: createEmptyDataViewBlockMarkup(),
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/page/${ fixture.page.id }`
			);

			await page.waitForFunction(
				( postId ) =>
					window.wp?.data
						?.select( 'core/editor' )
						?.getCurrentPostId?.() === postId,
				fixture.page.id,
				{ timeout: 15_000 }
			);

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			await canvas.getByLabel( 'Name' ).fill( 'Inline Books' );
			await canvas
				.getByRole( 'button', { name: 'Create collection' } )
				.click();

			await expect( canvas.getByText( 'Title' ) ).toBeVisible();
			await expect(
				page
					.locator( '.cortext-sidebar' )
					.getByText( 'Inline Books', { exact: true } )
			).toBeVisible();

			await page.evaluate( async () => {
				await window.wp.data.dispatch( 'core/editor' ).savePost();
			} );
			await page.waitForFunction(
				() => ! window.wp.data.select( 'core/editor' ).isSavingPost()
			);

			let saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_pages/${ fixture.page.id }`,
				params: { context: 'edit' },
			} );

			fixture.createdCollectionId = parseCollectionIdFromContent(
				saved.content.raw
			);
			expect( fixture.createdCollectionId ).toBeGreaterThan( 0 );

			const createdCollection = await requestUtils.rest( {
				path: `/wp/v2/crtxt_collections/${ fixture.createdCollectionId }`,
				params: { context: 'edit' },
			} );
			fixture.createdFieldIds = createdCollection.meta.fields || [];
			expect( createdCollection.meta.slug ).toBe( 'inline-books' );
			expect( fixture.createdFieldIds ).toEqual( [] );

			await page
				.getByRole( 'button', { name: 'Change collection' } )
				.click();
			await page
				.locator( '.cortext-data-view-toolbar-popover' )
				.getByRole( 'button', { name: /E2E Books/ } )
				.click();

			await expect(
				canvas.getByText( 'The Left Hand of Darkness' )
			).toBeVisible();

			await page.evaluate( async () => {
				await window.wp.data.dispatch( 'core/editor' ).savePost();
			} );
			await page.waitForFunction(
				() => ! window.wp.data.select( 'core/editor' ).isSavingPost()
			);

			saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_pages/${ fixture.page.id }`,
				params: { context: 'edit' },
			} );

			expect( saved.content.raw ).toContain(
				`"collectionId":${ fixture.collection.id }`
			);
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_pages/${ fixture.page.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.entry &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`
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
			if ( fixture.createdFieldIds ) {
				for ( const fieldId of fixture.createdFieldIds ) {
					await deleteIfCreated(
						requestUtils,
						`/wp/v2/crtxt_fields/${ fieldId }`
					);
				}
			}
			await deleteIfCreated(
				requestUtils,
				fixture.createdCollectionId &&
					`/wp/v2/crtxt_collections/${ fixture.createdCollectionId }`
			);
		}
	} );

	test( 'drops dead field references from the view when a field is deleted', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			const suffix = Date.now().toString( 36 ).slice( -4 );
			const slug = `e2eclean${ suffix }`;
			fixture.slug = slug;

			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: `Cleanup ${ suffix }`,
					status: 'private',
					meta: { slug },
				},
			} );

			fixture.fieldA = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: 'Author',
					status: 'private',
					meta: { type: 'text' },
				},
			} );

			fixture.fieldB = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: 'Notes',
					status: 'private',
					meta: { type: 'text' },
				},
			} );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: {
						fields: [
							String( fixture.fieldA.id ),
							String( fixture.fieldB.id ),
						],
					},
				},
			} );

			const fieldAKey = `field-${ fixture.fieldA.id }`;
			const fieldBKey = `field-${ fixture.fieldB.id }`;
			const staleView = {
				type: 'table',
				fields: [ 'title', fieldAKey, fieldBKey ],
				sort: { field: fieldAKey, direction: 'asc' },
				filters: [
					{
						field: fieldAKey,
						operator: 'is',
						value: 'X',
					},
					{
						field: fieldBKey,
						operator: 'is',
						value: 'Y',
					},
				],
				perPage: 25,
				page: 1,
				search: 'preserved',
				layout: { density: 'comfortable' },
			};
			const blockMarkup = `<!-- wp:cortext/data-view ${ JSON.stringify( {
				collectionId: fixture.collection.id,
				view: staleView,
			} ) } /-->`;

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'View cleanup test page',
					status: 'private',
					content: blockMarkup,
				},
			} );

			await requestUtils.rest( {
				method: 'DELETE',
				path: `/wp/v2/crtxt_fields/${ fixture.fieldA.id }`,
				params: { force: true },
			} );
			fixture.fieldADeleted = true;

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: { fields: [ String( fixture.fieldB.id ) ] },
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/page/${ fixture.page.id }`
			);

			await page.waitForFunction(
				( postId ) =>
					window.wp?.data
						?.select( 'core/editor' )
						?.getCurrentPostId?.() === postId,
				fixture.page.id,
				{ timeout: 15_000 }
			);

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			await expect( canvas.getByText( 'Notes' ) ).toBeVisible();

			await page.evaluate( async () => {
				await window.wp.data.dispatch( 'core/editor' ).savePost();
			} );
			await page.waitForFunction(
				() => ! window.wp.data.select( 'core/editor' ).isSavingPost()
			);

			const saved = await requestUtils.rest( {
				path: `/wp/v2/crtxt_pages/${ fixture.page.id }`,
				params: { context: 'edit' },
			} );

			expect( saved.content.raw ).not.toContain( fieldAKey );
			expect( saved.content.raw ).toContain( fieldBKey );
			expect( saved.content.raw ).toContain( '"title"' );
			expect( saved.content.raw ).toContain( '"sort":null' );
			expect( saved.content.raw ).toContain( '"search":"preserved"' );
			expect( saved.content.raw ).toContain(
				'"layout":{"density":"comfortable"}'
			);
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_pages/${ fixture.page.id }`
			);
			if ( ! fixture.fieldADeleted ) {
				await deleteIfCreated(
					requestUtils,
					fixture.fieldA &&
						`/wp/v2/crtxt_fields/${ fixture.fieldA.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.fieldB && `/wp/v2/crtxt_fields/${ fixture.fieldB.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );
} );
