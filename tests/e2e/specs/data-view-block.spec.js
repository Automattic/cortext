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
	} catch {
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

async function createCalculationFixture( requestUtils ) {
	const suffix = Date.now().toString( 36 ).slice( -4 );
	const slug = `e2ecalc${ suffix }`;

	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_collections',
		data: {
			title: `E2E Calculations ${ suffix }`,
			status: 'private',
			meta: { slug },
		},
	} );

	const fields = {};
	for ( const [ key, config ] of Object.entries( {
		pages: { title: 'Pages', type: 'number' },
		status: { title: 'Status', type: 'text' },
		due: { title: 'Due', type: 'date' },
		done: { title: 'Done', type: 'checkbox' },
	} ) ) {
		fields[ key ] = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/crtxt_fields',
			data: {
				title: config.title,
				status: 'private',
				meta: { type: config.type },
			},
		} );
	}

	await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/crtxt_collections/${ collection.id }`,
		data: {
			meta: {
				fields: Object.values( fields ).map( ( field ) =>
					String( field.id )
				),
			},
		},
	} );

	const rows = [];
	for ( const row of [
		{
			title: 'Alpha Book',
			pages: 10,
			status: 'Alpha',
			due: '2026-01-01',
			done: false,
		},
		{
			title: 'Beta Book',
			pages: 20,
			status: 'Beta',
			due: '2026-02-01',
			done: true,
		},
		{
			title: 'Gamma Book',
			pages: 30,
			status: 'Gamma',
			due: '2026-03-01',
			done: false,
		},
	] ) {
		rows.push(
			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ slug }`,
				data: {
					title: row.title,
					status: 'private',
					meta: {
						[ `field-${ fields.pages.id }` ]: row.pages,
						[ `field-${ fields.status.id }` ]: row.status,
						[ `field-${ fields.due.id }` ]: row.due,
						[ `field-${ fields.done.id }` ]: row.done,
					},
				},
			} )
		);
	}

	return { collection, fields, rows, slug };
}

function createDataViewBlockMarkup( collectionId, viewOverrides = {} ) {
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
			...viewOverrides,
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
				.locator(
					'[data-toolbar-item="true"][aria-label="Change collection"]'
				)
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

	test( 'creates a new row from the New button and prefills from a single-equality filter', async ( {
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

			const filterValue = 'Ursula K. Le Guin';
			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'New row + prefill',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						filters: [
							{
								field: `field-${ fixture.field.id }`,
								operator: 'is',
								value: filterValue,
							},
						],
					} ),
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
			await expect(
				canvas.getByText( 'The Left Hand of Darkness' )
			).toBeVisible();

			const beforeRows = await requestUtils.rest( {
				path: `/wp/v2/crtxt_${ fixture.slug }`,
				params: {
					context: 'edit',
					status: 'draft,private,publish',
					per_page: 100,
				},
			} );

			await canvas
				.getByRole( 'button', { name: 'New', exact: true } )
				.click();

			await expect
				.poll( async () => {
					const rows = await requestUtils.rest( {
						path: `/wp/v2/crtxt_${ fixture.slug }`,
						params: {
							context: 'edit',
							status: 'draft,private,publish',
							per_page: 100,
						},
					} );
					return rows.length;
				} )
				.toBe( beforeRows.length + 1 );

			const afterRows = await requestUtils.rest( {
				path: `/wp/v2/crtxt_${ fixture.slug }`,
				params: {
					context: 'edit',
					status: 'draft,private,publish',
					per_page: 100,
				},
			} );

			const beforeIds = new Set( beforeRows.map( ( r ) => r.id ) );
			const newRow = afterRows.find( ( r ) => ! beforeIds.has( r.id ) );
			expect( newRow ).toBeTruthy();
			expect( newRow.meta[ `field-${ fixture.field.id }` ] ).toBe(
				filterValue
			);

			fixture.createdRowId = newRow.id;
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.createdRowId &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.createdRowId }`
			);
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

	test( 'inline edit on a text cell persists', async ( {
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
					title: 'Inline edit text cell',
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
			const cell = canvas.getByText( 'Ursula K. Le Guin', {
				exact: true,
			} );
			await expect( cell ).toBeVisible();
			await cell.click();

			// `getByRole('textbox', ...)` rather than `getByLabel`: the
			// editable cell's display shell also carries `aria-label="Author"`
			// (so a screen reader names the cell when it's the focused
			// "button" in display mode), and strict mode matches both the
			// shell and the editor input. Filtering by role disambiguates.
			const input = canvas.getByRole( 'textbox', {
				name: 'Author',
				exact: true,
			} );
			await expect( input ).toBeVisible();
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

			await expect( canvas.getByText( 'U. K. Le Guin' ) ).toBeVisible();
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

	test( 'row detail saves properties and remembers the selected mode', async ( {
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

			fixture.tagsField = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: 'Tags',
					status: 'private',
					meta: {
						type: 'multiselect',
						options: JSON.stringify( [
							{
								value: 'research',
								label: 'Research',
								color: 'blue',
							},
							{ value: 'data', label: 'Data', color: 'green' },
						] ),
					},
				},
			} );

			fixture.yearField = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: 'Year',
					status: 'private',
					meta: { type: 'number' },
				},
			} );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: {
						fields: [
							String( fixture.field.id ),
							String( fixture.tagsField.id ),
							String( fixture.yearField.id ),
						],
					},
				},
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`,
				data: {
					meta: {
						[ `field-${ fixture.field.id }` ]: 'Ursula K. Le Guin',
						[ `field-${ fixture.tagsField.id }` ]: [
							'research',
							'data',
						],
						[ `field-${ fixture.yearField.id }` ]: 1969,
					},
				},
			} );

			fixture.secondEntry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ fixture.slug }`,
				data: {
					title: 'Kindred',
					status: 'private',
					meta: {
						[ `field-${ fixture.field.id }` ]: 'Octavia Butler',
					},
				},
			} );

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Row detail page',
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

			const canvas = page.frameLocator(
				'.cortext-canvas__visual iframe[name="editor-canvas"]'
			);
			await expect(
				canvas.locator( '.dataviews-view-table__actions-column' )
			).toHaveCount( 0 );
			const firstRow = canvas
				.locator( '.cortext-data-view tbody tr' )
				.first();
			const titleCellOpenButton = canvas
				.locator( '.cortext-title-cell__open' )
				.first();
			await expect( titleCellOpenButton ).toHaveAttribute(
				'aria-label',
				'Open row'
			);
			await expect( titleCellOpenButton ).toHaveCSS( 'opacity', '0' );
			await firstRow.hover();
			await expect( titleCellOpenButton ).toHaveCSS( 'opacity', '1' );
			await expect( titleCellOpenButton ).toContainText( 'Open' );
			await expect(
				firstRow
					.locator( '.cortext-editable-cell__display' )
					.first()
			).toHaveCSS( 'cursor', 'pointer' );
			await titleCellOpenButton.click();
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBe( String( fixture.entry.id ) );
			expect(
				new URL( page.url() ).searchParams.get( 'rowCollection' )
			).toBe( String( fixture.collection.id ) );

			await expect(
				canvas.getByRole( 'dialog', {
					name: 'Row detail',
				} )
			).toHaveCount( 0 );

			const detail = page.getByRole( 'dialog', {
				name: 'Row detail',
			} );
			await expect( detail ).toBeVisible();
			await detail.hover();
			await expect( firstRow ).toHaveCSS(
				'background-color',
				'rgb(248, 248, 248)'
			);
			await expect( titleCellOpenButton ).toHaveCSS( 'opacity', '1' );
			const detailTitle = detail.getByRole( 'textbox', {
				name: 'Title',
				exact: true,
			} );
			await expect( detailTitle ).toHaveValue(
				'The Left Hand of Darkness'
			);
			const tagsLabel = detail
				.locator(
					'.cortext-row-detail__properties--rows .cortext-row-detail__property-label'
				)
				.filter( { hasText: 'Tags' } );
			await expect( tagsLabel ).toHaveCSS( 'cursor', 'default' );
			await tagsLabel.evaluate( ( node ) =>
				node.setAttribute( 'data-e2e-stable-label', 'tags' )
			);
			const tagsTrigger = detail.getByRole( 'button', {
				name: 'Tags',
				exact: true,
			} );
			await expect(
				tagsTrigger.locator( '.cortext-chips > .cortext-chip' )
			).toHaveText( [ 'Research', 'Data' ] );
			await tagsTrigger.click();
			const optionsPopover = page.locator(
				'.cortext-edit-options-popover'
			);
			await expect( optionsPopover ).toBeVisible();
			await expect(
				optionsPopover.locator( '.cortext-chip' ).filter( {
					hasText: 'Research',
				} )
			).toHaveCount( 2 );
			await detailTitle.click();
			await expect( optionsPopover ).toBeHidden();

			const delayedSecondRowPattern = new RegExp(
				`/wp-json/wp/v2/crtxt_${ fixture.slug }/${ fixture.secondEntry.id }(\\?|$)`
			);
			const delaySecondRow = async ( route ) => {
				await page.waitForTimeout( 350 );
				await route.continue();
			};
			await page.route( delayedSecondRowPattern, delaySecondRow );
			await detail.getByRole( 'button', { name: 'Row below' } ).click();
			await expect( detail.locator( '.components-spinner' ) ).toHaveCount(
				0
			);
			await expect( detailTitle ).toHaveValue(
				'The Left Hand of Darkness'
			);
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBe( String( fixture.secondEntry.id ) );
			await expect( detailTitle ).toHaveValue( 'Kindred' );
			await expect(
				detail.locator( '[data-e2e-stable-label="tags"]' )
			).toHaveText( 'Tags' );
			await page.unroute( delayedSecondRowPattern, delaySecondRow );
			await detail.getByRole( 'button', { name: 'Row above' } ).click();
			await expect( detailTitle ).toHaveValue(
				'The Left Hand of Darkness'
			);
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBe( String( fixture.entry.id ) );

			const goBack = page.getByRole( 'button', { name: 'Go back' } );
			const goForward = page.getByRole( 'button', {
				name: 'Go forward',
			} );
			await expect( goBack ).toBeEnabled();
			await goBack.click();
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBe( String( fixture.secondEntry.id ) );
			await expect( detailTitle ).toHaveValue( 'Kindred' );
			await goBack.click();
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBe( String( fixture.entry.id ) );
			await expect( detailTitle ).toHaveValue(
				'The Left Hand of Darkness'
			);
			await expect( goForward ).toBeEnabled();
			await goForward.click();
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBe( String( fixture.secondEntry.id ) );
			await expect( detailTitle ).toHaveValue( 'Kindred' );
			await goForward.click();
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBe( String( fixture.entry.id ) );
			await expect( detailTitle ).toHaveValue(
				'The Left Hand of Darkness'
			);

			await detail.getByRole( 'button', { name: 'Hide fields' } ).click();
			const collapsedFieldsButton = detail.locator(
				'.cortext-row-detail__fields-indicator'
			);
			await expect(
				detail.getByRole( 'textbox', { name: 'Title', exact: true } )
			).toBeVisible();
			await expect( collapsedFieldsButton ).toBeVisible();
			await expect(
				detail.locator( '.cortext-row-detail__content-editor' )
			).toBeVisible();
			await expect(
				detail.getByRole( 'button', { name: 'Show fields' } )
			).toBeVisible();
			await detail.getByRole( 'button', { name: 'Show fields' } ).click();
			await expect(
				detail.locator( '.cortext-row-detail__properties--rows' )
			).toBeVisible();

			await detailTitle.click();
			await expect( detailTitle ).toHaveCSS( 'border-top-width', '0px' );
			await expect( detailTitle ).toHaveCSS(
				'background-color',
				'rgba(0, 0, 0, 0)'
			);
			await page.keyboard.press( 'ControlOrMeta+A' );
			await page.keyboard.press( 'Backspace' );
			await page.keyboard.type( 'Changed row detail title' );
			await expect( firstRow.locator( 'td' ).first() ).toContainText(
				'Changed row detail title'
			);
			await detail
				.getByRole( 'textbox', { name: 'Author', exact: true } )
				.fill( 'Octavia Butler' );
			await expect( firstRow.locator( 'td' ).nth( 1 ) ).toContainText(
				'Octavia Butler'
			);
			const yearProperty = detail.getByRole( 'textbox', {
				name: 'Year',
				exact: true,
			} );
			await yearProperty.click();
			await page.keyboard.press( 'ControlOrMeta+A' );
			await page.keyboard.press( 'Backspace' );
			await page.keyboard.type( '20a6' );
			await expect( yearProperty ).toHaveValue( '206' );
			await page.keyboard.press( 'ControlOrMeta+A' );
			await page.keyboard.press( 'Backspace' );
			await page.keyboard.type( '2026' );

			await expect(
				detail.getByRole( 'button', { name: 'Center modal' } )
			).toBeVisible();
			await expect(
				detail.getByRole( 'button', { name: 'Full page' } )
			).toBeVisible();
			await expect(
				detail.getByRole( 'button', { name: 'Change layout' } )
			).toHaveCount( 0 );
			await detail
				.getByRole( 'button', { name: 'Center modal' } )
				.click();
			const modalDetail = page.locator(
				'.components-modal__frame.cortext-row-detail-modal'
			);
			await expect( modalDetail ).toBeVisible();
			await expect(
				modalDetail.getByRole( 'button', { name: 'Center modal' } )
			).toHaveCount( 0 );
			await expect(
				modalDetail.getByRole( 'button', { name: 'Side peek' } )
			).toBeVisible();
			await expect(
				modalDetail.getByRole( 'button', { name: 'Full page' } )
			).toBeVisible();
			await modalDetail
				.getByRole( 'button', { name: 'Full page' } )
				.click();
			await expect( detail ).toBeHidden();
			await expect(
				page
					.getByRole( 'navigation', { name: 'Breadcrumb' } )
					.getByText( 'Changed row detail title' )
			).toBeVisible();

			await page
				.getByRole( 'navigation', { name: 'Breadcrumb' } )
				.getByRole( 'button', {
					name: fixture.collection.title.raw,
					exact: true,
				} )
				.click();
			await expect
				.poll( () => new URL( page.url() ).searchParams.get( 'row' ) )
				.toBeNull();
			await expect(
				canvas.getByRole( 'button', { name: 'Open row' } ).first()
			).toBeVisible();

			await expect
				.poll( async () => {
					const row = await requestUtils.rest( {
						path: `/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`,
						params: { context: 'edit' },
					} );
					return {
						title: row.title.raw,
						author: row.meta[ `field-${ fixture.field.id }` ],
						year: row.meta[ `field-${ fixture.yearField.id }` ],
					};
				} )
				.toEqual( {
					title: 'Changed row detail title',
					author: 'Octavia Butler',
					year: 2026,
				} );

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
			expect( saved.content.raw ).not.toContain(
				'"rowDetailMode":"full"'
			);
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.entry &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.secondEntry &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.secondEntry.id }`
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
				fixture.tagsField &&
					`/wp/v2/crtxt_fields/${ fixture.tagsField.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.yearField &&
					`/wp/v2/crtxt_fields/${ fixture.yearField.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );

	test( 'renders typed cells for url, checkbox, number, select, and multiselect', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = { fieldIds: [] };

		try {
			const suffix = Date.now().toString( 36 ).slice( -4 );
			const slug = `e2etypes${ suffix }`;
			fixture.slug = slug;

			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: `Typed cells ${ suffix }`,
					status: 'private',
					meta: { slug },
				},
			} );

			const createField = async ( title, type, options ) => {
				const meta = { type };
				if ( options ) {
					meta.options = JSON.stringify( options );
				}
				const field = await requestUtils.rest( {
					method: 'POST',
					path: '/wp/v2/crtxt_fields',
					data: { title, status: 'private', meta },
				} );
				fixture.fieldIds.push( field.id );
				return field;
			};

			const urlField = await createField( 'Homepage', 'url' );
			const checkField = await createField( 'Done', 'checkbox' );
			const numberField = await createField( 'Score', 'number' );
			const selectField = await createField( 'Status', 'select', [
				{ value: 'open', label: 'Open', color: '#ffe2dd' },
				{ value: 'closed', label: 'Closed', color: '#e8e8e7' },
			] );
			const tagsField = await createField( 'Tags', 'multiselect', [
				{ value: 'a', label: 'Alpha', color: '#ddebf1' },
				{ value: 'b', label: 'Beta', color: '#ddedea' },
			] );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: {
						fields: fixture.fieldIds.map( String ),
					},
				},
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ slug }`,
				data: {
					title: 'Sample row',
					status: 'private',
					meta: {
						[ `field-${ urlField.id }` ]:
							'https://example.com/welcome',
						[ `field-${ checkField.id }` ]: true,
						[ `field-${ numberField.id }` ]: 12.5,
						[ `field-${ selectField.id }` ]: 'open',
						[ `field-${ tagsField.id }` ]: [ 'a', 'b' ],
					},
				},
			} );

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Typed cell rendering page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [
							'title',
							`field-${ urlField.id }`,
							`field-${ checkField.id }`,
							`field-${ numberField.id }`,
							`field-${ selectField.id }`,
							`field-${ tagsField.id }`,
						],
					} ),
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
			await expect( canvas.getByText( 'Sample row' ) ).toBeVisible();

			// URL: anchor with correct attributes.
			const link = canvas.getByRole( 'link', {
				name: 'https://example.com/welcome',
			} );
			await expect( link ).toBeVisible();
			await expect( link ).toHaveAttribute(
				'href',
				'https://example.com/welcome'
			);
			await expect( link ).toHaveAttribute( 'target', '_blank' );
			await expect( link ).toHaveAttribute(
				'rel',
				'noopener noreferrer'
			);

			// Number: decimal value renders intact.
			await expect( canvas.getByText( '12.5' ) ).toBeVisible();

			const table = canvas.locator( '.dataviews-view-table' );
			const firstRow = table.locator( 'tbody > tr' ).first();

			// Select: chip with the option's color (Notion shape parsed).
			const statusChip = firstRow
				.locator( 'td' )
				.nth( 4 )
				.locator( '.cortext-chip', { hasText: 'Open' } );
			await expect( statusChip ).toBeVisible();
			await expect( statusChip ).toHaveCSS( 'cursor', 'pointer' );
			await expect( statusChip ).toHaveClass( /cortext-chip/ );
			await expect( statusChip ).not.toHaveClass(
				/cortext-chip--neutral/
			);
			const statusChipGeometry = await statusChip.evaluate( ( chip ) => {
				const shell = chip.closest( '.cortext-editable-cell__shell' );
				const chipRect = chip.getBoundingClientRect();
				const shellRect = shell.getBoundingClientRect();

				return {
					chipWidth: chipRect.width,
					shellWidth: shellRect.width,
				};
			} );
			expect( statusChipGeometry.chipWidth ).toBeLessThan(
				statusChipGeometry.shellWidth - 8
			);

			// Multiselect: one chip per value with their respective colors.
			const tagAlpha = canvas.getByText( 'Alpha', { exact: true } );
			const tagBeta = canvas.getByText( 'Beta', { exact: true } );
			await expect( tagAlpha ).toHaveClass( /cortext-chip/ );
			await expect( tagBeta ).toHaveClass( /cortext-chip/ );

			// Checkbox: the cell is the editable CheckboxControl, not the
			// formatDisplay icon path. Confirm a checked input is rendered.
			const checkbox = canvas
				.locator( '.cortext-cell-checkbox input[type="checkbox"]' )
				.first();
			await expect( checkbox ).toBeChecked();
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
			for ( const fieldId of fixture.fieldIds ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_fields/${ fieldId }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );

	test( 'navigates the field format panel from the column menu with keyboard', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			const suffix = Date.now().toString( 36 ).slice( -4 );
			const slug = `e2eformat${ suffix }`;
			fixture.slug = slug;

			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: `Format keyboard ${ suffix }`,
					status: 'private',
					meta: { slug },
				},
			} );

			fixture.field = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: 'Score',
					status: 'private',
					meta: { type: 'number' },
				},
			} );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: { fields: [ String( fixture.field.id ) ] },
				},
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ slug }`,
				data: {
					title: 'Keyboard row',
					status: 'private',
					meta: {
						[ `field-${ fixture.field.id }` ]: 12.5,
					},
				},
			} );

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Format keyboard page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title', `field-${ fixture.field.id }` ],
					} ),
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
			const scoreHeader = canvas.getByRole( 'columnheader', {
				name: /Score/,
			} );
			const scoreButton = scoreHeader
				.getByRole( 'button', { name: 'Score' } )
				.filter( { hasText: 'Score' } );

			await expect( scoreButton ).toBeVisible();
			await scoreButton.focus();
			await scoreButton.press( 'Enter' );

			const renameItem = canvas.getByRole( 'menuitem', {
				name: 'Rename',
			} );
			const editFieldItem = canvas.getByRole( 'menuitem', {
				name: 'Edit field',
			} );
			await expect( renameItem ).toBeFocused();

			await page.keyboard.press( 'ArrowDown' );
			await expect( editFieldItem ).toBeFocused();

			await page.keyboard.press( 'ArrowRight' );
			const formatPanel = page.locator( '.cortext-format-submenu' );
			const numberFormatRow = formatPanel.getByRole( 'button', {
				name: /Number format/,
			} );
			await expect( numberFormatRow ).toBeFocused();

			await page.keyboard.press( 'ArrowRight' );
			const numberFormatFlyout = page.locator(
				'.cortext-format-submenu__flyout'
			);
			const plainNumberOption = numberFormatFlyout.getByRole(
				'menuitemradio',
				{
					name: 'Number',
					exact: true,
				}
			);
			await expect( plainNumberOption ).toBeFocused();

			await page.keyboard.press( 'ArrowDown' );
			await expect(
				numberFormatFlyout.getByRole( 'menuitemradio', {
					name: 'Number with commas',
				} )
			).toBeFocused();

			await page.keyboard.press( 'ArrowLeft' );
			await expect( numberFormatFlyout ).toHaveCount( 0 );
			await expect( numberFormatRow ).toBeFocused();

			const decimalPlacesRow = formatPanel.getByRole( 'button', {
				name: /Decimal places/,
			} );

			await page.keyboard.press( 'ArrowDown' );
			await expect( decimalPlacesRow ).toBeFocused();

			await page.keyboard.press( 'ArrowUp' );
			await expect( numberFormatRow ).toBeFocused();

			await page.keyboard.press( 'ArrowDown' );
			await expect( decimalPlacesRow ).toBeFocused();

			await page.keyboard.press( 'ArrowLeft' );
			await expect( formatPanel ).toHaveCount( 0 );
			await expect( editFieldItem ).toBeFocused();
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

	test( 'renders system field columns as read-only when visible', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			const suffix = Date.now().toString( 36 ).slice( -4 );
			const slug = `e2esys${ suffix }`;
			fixture.slug = slug;

			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: `System fields ${ suffix }`,
					status: 'private',
					meta: { slug },
				},
			} );

			fixture.field = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: 'Note',
					status: 'private',
					meta: { type: 'text' },
				},
			} );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: { fields: [ String( fixture.field.id ) ] },
				},
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ slug }`,
				data: {
					title: 'Sample row',
					status: 'private',
					meta: {
						[ `field-${ fixture.field.id }` ]: 'a note',
					},
				},
			} );

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'System field page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [
							'title',
							'created_at',
							'created_by',
							'modified_at',
							'modified_by',
						],
					} ),
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
			await expect( canvas.getByText( 'Sample row' ) ).toBeVisible();

			// Each system field cell renders inside a read-only span; no
			// EditableCell mounts, no inline edit affordance.
			const readOnlyCells = canvas.locator(
				'.cortext-data-view td .cortext-cell-readonly'
			);
			// At least one read-only cell per system column should be
			// present (the row may also have read-only cells from any
			// non-editable custom field types, but we configured none of
			// those here).
			await expect( readOnlyCells.first() ).toBeVisible();
			expect( await readOnlyCells.count() ).toBeGreaterThanOrEqual( 4 );

			// `created_by` resolves to a non-empty author name.
			const createdByCell = readOnlyCells.nth( 1 );
			await expect( createdByCell ).not.toHaveText( '' );

			// Read-only cells don't expose an editable shell; clicking
			// them must not produce a CheckboxControl, TextControl, or
			// any of EditableCell's edit affordances.
			await createdByCell.click();
			await expect(
				canvas.locator( '.cortext-editable-cell--editing' )
			).toHaveCount( 0 );
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

	test( 'global search filters rows by searchable text fields', async ( {
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

			// A second entry whose Author value won't match the query.
			fixture.entry2 = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ fixture.slug }`,
				data: {
					title: 'Dune',
					status: 'private',
					meta: {
						[ `field-${ fixture.field.id }` ]: 'Frank Herbert',
					},
				},
			} );

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Global search test page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						search: 'Le Guin',
					} ),
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

			// The matching row should be visible.
			await expect(
				canvas.getByText( 'The Left Hand of Darkness' )
			).toBeVisible();
			await expect(
				canvas.getByText( 'Ursula K. Le Guin' )
			).toBeVisible();

			// The non-matching row should be filtered out.
			await expect( canvas.getByText( 'Dune' ) ).toBeHidden();
			await expect( canvas.getByText( 'Frank Herbert' ) ).toBeHidden();
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.entry2 &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry2.id }`
			);
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

	test( 'selects table footer calculations and persists them in the block view', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			Object.assign(
				fixture,
				await createCalculationFixture( requestUtils )
			);
			const pageKey = `field-${ fixture.fields.pages.id }`;
			const statusKey = `field-${ fixture.fields.status.id }`;
			const dueKey = `field-${ fixture.fields.due.id }`;
			const doneKey = `field-${ fixture.fields.done.id }`;

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Table calculations persistence page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [
							'title',
							pageKey,
							statusKey,
							dueKey,
							doneKey,
						],
					} ),
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
			await expect( canvas.getByText( 'Pages' ) ).toBeVisible();
			const footer = canvas.locator( 'tfoot.cortext-table-calculations' );
			const footerCells = footer.locator( 'td' );
			await expect( footer ).toHaveCount( 0 );
			const openColumnDropdown = async ( scope, name ) => {
				const button = scope
					.getByRole( 'button', { name } )
					.filter( { hasText: name } );
				await button.dispatchEvent( 'click' );
			};
			const clickMenuItem = async ( name ) => {
				for ( const role of [ 'menuitem', 'menuitemradio' ] ) {
					try {
						await canvas
							.getByRole( role, { name, exact: true } )
							.click( { timeout: 500 } );
						return;
					} catch {}
				}
				for ( const role of [ 'menuitem', 'menuitemradio' ] ) {
					try {
						await page
							.getByRole( role, { name, exact: true } )
							.click( { timeout: 500 } );
						return;
					} catch {}
				}
				await canvas.getByText( name, { exact: true } ).click();
			};

			await openColumnDropdown(
				canvas.getByRole( 'columnheader', { name: /Pages/ } ),
				'Pages'
			);
			await clickMenuItem( 'Calculate' );
			await clickMenuItem( 'Math' );
			await clickMenuItem( 'Sum' );
			await expect( footer ).toHaveCount( 1 );
			await expect( footerCells.nth( 1 ) ).toContainText( 'Sum' );
			await expect( footerCells.nth( 1 ) ).toContainText( '60' );
			await expect
				.poll( async () => {
					const cell = await footerCells.nth( 1 ).boundingBox();
					const button = await footerCells
						.nth( 1 )
						.locator( '.cortext-table-calculation__button' )
						.boundingBox();
					if ( ! cell || ! button ) {
						return false;
					}
					return button.width >= cell.width - 1;
				} )
				.toBe( true );
			await expect( footerCells.nth( 2 ) ).not.toContainText(
				'Calculate'
			);

			const emptyStatusCalculation = footerCells
				.nth( 2 )
				.locator( '.cortext-table-calculation__button' );
			await expect( emptyStatusCalculation ).toHaveAttribute(
				'data-empty-label',
				'Calculate'
			);
			await expect
				.poll( () =>
					emptyStatusCalculation.evaluate(
						( element ) =>
							window.getComputedStyle( element, '::before' )
								.opacity
					)
				)
				.toBe( '0' );
			await emptyStatusCalculation.hover();
			await expect
				.poll( () =>
					emptyStatusCalculation.evaluate(
						( element ) =>
							window.getComputedStyle( element, '::before' )
								.opacity
					)
				)
				.toBe( '1' );

			await openColumnDropdown(
				canvas.getByRole( 'columnheader', { name: /Status/ } ),
				'Status'
			);
			await clickMenuItem( 'Calculate' );
			await clickMenuItem( 'Count' );
			await clickMenuItem( 'Count unique values' );
			await expect( footerCells.nth( 2 ) ).toContainText( '3' );

			await footerCells
				.nth( 3 )
				.locator( '.cortext-table-calculation__button' )
				.click();
			await clickMenuItem( 'Math' );
			await clickMenuItem( 'Min' );
			await expect( footerCells.nth( 3 ) ).not.toContainText(
				'Calculate'
			);

			await footerCells
				.nth( 4 )
				.locator( '.cortext-table-calculation__button' )
				.click();
			await clickMenuItem( 'Count' );
			await clickMenuItem( 'Count all' );
			await expect( footerCells.nth( 4 ) ).toContainText( '3' );

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
			expect( saved.content.raw ).toContain( '"calculations"' );
			expect( saved.content.raw ).toContain( `"${ pageKey }":"sum"` );
			expect( saved.content.raw ).toContain(
				`"${ statusKey }":"countUnique"`
			);
			expect( saved.content.raw ).toContain( `"${ dueKey }":"min"` );
			expect( saved.content.raw ).toContain( `"${ doneKey }":"count"` );

			await page.reload();
			await expect( footerCells.nth( 1 ) ).toContainText( 'Sum' );
			await expect( footerCells.nth( 1 ) ).toContainText( '60' );
		} finally {
			for ( const row of fixture.rows ?? [] ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_${ fixture.slug }/${ row.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_pages/${ fixture.page.id }`
			);
			for ( const field of Object.values( fixture.fields ?? {} ) ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_fields/${ field.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );

	test( 'calculates against filtered rows before pagination', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			Object.assign(
				fixture,
				await createCalculationFixture( requestUtils )
			);
			const pageKey = `field-${ fixture.fields.pages.id }`;
			const statusKey = `field-${ fixture.fields.status.id }`;

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Filtered calculation page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title', pageKey ],
						filters: [
							{
								field: statusKey,
								operator: 'isAny',
								value: [ 'Alpha', 'Beta' ],
							},
						],
						calculations: { [ pageKey ]: 'sum' },
						perPage: 1,
						page: 1,
					} ),
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
			await expect( canvas.getByText( 'Alpha Book' ) ).toBeVisible();
			await expect( canvas.getByText( 'Beta Book' ) ).toBeHidden();
			await expect( canvas.getByText( 'Gamma Book' ) ).toBeHidden();
			await expect(
				canvas.locator( 'tfoot.cortext-table-calculations td' ).nth( 1 )
			).toContainText( '30' );
		} finally {
			for ( const row of fixture.rows ?? [] ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_${ fixture.slug }/${ row.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_pages/${ fixture.page.id }`
			);
			for ( const field of Object.values( fixture.fields ?? {} ) ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_fields/${ field.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );

	test( 'resizes a column via drag and persists the width across reload', async ( {
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
					title: 'Column resize persistence page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title', `field-${ fixture.field.id }` ],
					} ),
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
			await expect( canvas.getByText( 'Author' ) ).toBeVisible();

			// Author is the second column (title is index 0, Author is
			// index 1); its resizer is at .nth(1) in DOM order. Native
			// pointer events drive the drag, and pointer capture keeps it
			// tracking even if the pointer leaves the editor canvas iframe.
			const resizer = canvas
				.locator( '.cortext-column-resizer' )
				.nth( 1 );
			const header = canvas
				.locator( '.dataviews-view-table thead > tr > th' )
				.nth( 1 );
			await expect( resizer ).toBeAttached();
			const startBox = await resizer.boundingBox();
			const startWidth = await header.evaluate(
				( el ) => el.getBoundingClientRect().width
			);

			const dragDelta = 80;
			await page.mouse.move(
				startBox.x + startBox.width / 2,
				startBox.y + startBox.height / 2
			);
			await page.mouse.down();
			await page.mouse.move(
				startBox.x + startBox.width / 2 + 10,
				startBox.y + startBox.height / 2,
				{ steps: 4 }
			);
			const firstMoveWidth = await header.evaluate(
				( el ) => el.getBoundingClientRect().width
			);
			expect( firstMoveWidth - startWidth ).toBeGreaterThan( 0 );
			expect( firstMoveWidth - startWidth ).toBeLessThanOrEqual( 12 );
			await page.mouse.move(
				startBox.x + startBox.width / 2 + dragDelta,
				startBox.y + startBox.height / 2,
				{ steps: 8 }
			);
			await page.mouse.up();

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

			const fieldKey = `field-${ fixture.field.id }`;
			expect( saved.content.raw ).toContain( '"styles"' );
			const widthMatch = saved.content.raw.match(
				new RegExp( `"${ fieldKey }":\\{[^}]*"width":(\\d+)` )
			);
			expect( widthMatch ).not.toBeNull();
			const persistedWidth = Number( widthMatch[ 1 ] );
			expect( persistedWidth ).toBeGreaterThan( 0 );
			expect( persistedWidth ).toBeLessThanOrEqual( 640 );

			await page.reload();
			await expect( canvas.getByText( 'Author' ) ).toBeVisible();

			const renderedWidth = await canvas
				.locator( '.dataviews-view-table thead > tr > th' )
				.nth( 1 )
				.evaluate( ( el ) => el.style.width );
			expect( renderedWidth ).toBe( `${ persistedWidth }px` );
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

	test( 'auto-sizes a column to content on resizer double click', async ( {
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

			const fieldKey = `field-${ fixture.field.id }`;
			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Column auto-size page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title', fieldKey ],
						layout: {
							density: 'compact',
							styles: {
								[ fieldKey ]: {
									width: 80,
									minWidth: 80,
									maxWidth: 80,
								},
							},
						},
					} ),
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
			await expect( canvas.getByText( 'Author' ) ).toBeVisible();

			const header = canvas
				.locator( '.dataviews-view-table thead > tr > th' )
				.nth( 1 );
			await expect( header ).toHaveAttribute( 'style', /width: 80px/ );

			const resizer = canvas
				.locator( '.cortext-column-resizer' )
				.nth( 1 );
			const box = await resizer.boundingBox();
			await page.mouse.dblclick(
				box.x + box.width / 2,
				box.y + box.height / 2
			);

			await expect
				.poll( async () =>
					header.evaluate(
						( el ) => Number.parseFloat( el.style.width ) || 0
					)
				)
				.toBeGreaterThan( 80 );

			const authorCell = canvas
				.locator( '.dataviews-view-table tbody > tr' )
				.first()
				.locator( 'td' )
				.nth( 1 );
			const overflow = await authorCell.evaluate( ( cell ) => {
				const wrapper = cell.querySelector(
					'.dataviews-view-table__cell-content-wrapper'
				);
				return wrapper.scrollWidth - wrapper.clientWidth;
			} );
			expect( overflow ).toBeLessThanOrEqual( 1 );
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

	test( 'ellipsis truncates narrow column headers without clipping focus rings', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = { fieldIds: [] };

		try {
			const suffix = Date.now().toString( 36 ).slice( -4 );
			const slug = `e2eheader${ suffix }`;
			fixture.slug = slug;

			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: `Header ellipsis ${ suffix }`,
					status: 'private',
					meta: { slug },
				},
			} );

			const field = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_fields',
				data: {
					title: 'Done?',
					status: 'private',
					meta: { type: 'checkbox' },
				},
			} );
			fixture.fieldIds.push( field.id );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: { meta: { fields: [ String( field.id ) ] } },
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ slug }`,
				data: {
					title: 'Header row',
					status: 'private',
					meta: { [ `field-${ field.id }` ]: true },
				},
			} );

			const fieldKey = `field-${ field.id }`;
			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Header ellipsis page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title', fieldKey ],
						layout: {
							density: 'compact',
							styles: {
								[ fieldKey ]: {
									width: 32,
									minWidth: 32,
									maxWidth: 32,
								},
							},
						},
					} ),
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
			const button = canvas
				.locator( '.dataviews-view-table-header-button:visible' )
				.nth( 1 );
			await button.focus();
			await expect( button ).toBeFocused();

			const headerState = await button.evaluate( ( el ) => {
				const span = el.querySelector( '.cortext-column-header-label' );
				const buttonRect = el.getBoundingClientRect();
				const spanRect = span.getBoundingClientRect();
				const styles = window.getComputedStyle( span );
				return {
					buttonLeft: buttonRect.left,
					buttonRight: buttonRect.right,
					spanLeft: spanRect.left,
					spanRight: spanRect.right,
					spanOverflow: styles.overflow,
					spanTextOverflow: styles.textOverflow,
					spanWhiteSpace: styles.whiteSpace,
				};
			} );

			const epsilon = 0.5;
			expect( headerState.spanOverflow ).toBe( 'hidden' );
			expect( headerState.spanTextOverflow ).toBe( 'ellipsis' );
			expect( headerState.spanWhiteSpace ).toBe( 'nowrap' );
			expect( headerState.spanLeft ).toBeGreaterThanOrEqual(
				headerState.buttonLeft - epsilon
			);
			expect( headerState.spanRight ).toBeLessThanOrEqual(
				headerState.buttonRight + epsilon
			);
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
			for ( const fieldId of fixture.fieldIds ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_fields/${ fieldId }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );

	test( 'keeps wrapped multiselect chips inside a narrow resized column', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = { fieldIds: [] };

		const assertContained = async ( canvas ) => {
			const table = canvas.locator( '.dataviews-view-table' );
			const tagsHeader = table.locator( 'thead > tr > th' ).nth( 1 );
			const tagsCell = table
				.locator( 'tbody > tr' )
				.first()
				.locator( 'td' )
				.nth( 1 );
			const dueCell = table
				.locator( 'tbody > tr' )
				.first()
				.locator( 'td' )
				.nth( 2 );

			await expect( tagsCell.locator( '.cortext-chip' ) ).toHaveCount(
				2
			);

			const tagsHeaderWidth = await tagsHeader.evaluate(
				( cell ) => cell.getBoundingClientRect().width
			);
			const geometry = await tagsCell.evaluate( ( cell ) => {
				const cellRect = cell.getBoundingClientRect();
				const chips = Array.from(
					cell.querySelectorAll( '.cortext-chip' )
				).map( ( chip ) => {
					const rect = chip.getBoundingClientRect();
					return {
						left: rect.left,
						right: rect.right,
						top: rect.top,
						bottom: rect.bottom,
					};
				} );
				const dueRect = cell.nextElementSibling.getBoundingClientRect();

				return {
					cell: {
						left: cellRect.left,
						right: cellRect.right,
					},
					due: {
						left: dueRect.left,
						right: dueRect.right,
					},
					chips,
				};
			} );
			const dueGeometry = await dueCell.evaluate( ( cell ) => {
				const cellRect = cell.getBoundingClientRect();
				const wrapper = cell.querySelector(
					'.dataviews-view-table__cell-content-wrapper'
				);
				const wrapperRect = wrapper.getBoundingClientRect();
				return {
					cell: {
						left: cellRect.left,
						right: cellRect.right,
					},
					wrapper: {
						left: wrapperRect.left,
						right: wrapperRect.right,
					},
				};
			} );

			const epsilon = 0.5;
			// Compact DataViews cells add 8px inline padding to the seeded
			// 80px table width, so the rendered border box is 88px.
			expect( tagsHeaderWidth ).toBeLessThanOrEqual( 88 + epsilon );
			for ( const chip of geometry.chips ) {
				expect( chip.left ).toBeGreaterThanOrEqual(
					geometry.cell.left - epsilon
				);
				expect( chip.right ).toBeLessThanOrEqual(
					geometry.cell.right + epsilon
				);
				expect( chip.right ).toBeLessThanOrEqual(
					geometry.due.left + epsilon
				);
			}
			expect( dueGeometry.wrapper.left ).toBeGreaterThanOrEqual(
				dueGeometry.cell.left - epsilon
			);
			expect( dueGeometry.wrapper.right ).toBeLessThanOrEqual(
				dueGeometry.cell.right + epsilon
			);
		};

		try {
			const suffix = Date.now().toString( 36 ).slice( -4 );
			const slug = `e2eoverlap${ suffix }`;
			fixture.slug = slug;

			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: `Resize overlap ${ suffix }`,
					status: 'private',
					meta: { slug },
				},
			} );

			const createField = async ( title, type, options ) => {
				const meta = { type };
				if ( options ) {
					meta.options = JSON.stringify( options );
				}
				const field = await requestUtils.rest( {
					method: 'POST',
					path: '/wp/v2/crtxt_fields',
					data: { title, status: 'private', meta },
				} );
				fixture.fieldIds.push( field.id );
				return field;
			};

			const tagsField = await createField( 'Tags', 'multiselect', [
				{ value: 'feature', label: 'feature', color: '#ddebf1' },
				{ value: 'docs', label: 'docs', color: '#e8def8' },
			] );
			const dueField = await createField( 'Due', 'date' );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: { fields: fixture.fieldIds.map( String ) },
				},
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ slug }`,
				data: {
					title: 'Resize overlap row',
					status: 'private',
					meta: {
						[ `field-${ tagsField.id }` ]: [ 'feature', 'docs' ],
						[ `field-${ dueField.id }` ]: '2026-05-15',
					},
				},
			} );

			const tagsKey = `field-${ tagsField.id }`;
			const dueKey = `field-${ dueField.id }`;
			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Column resize overlap page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title', tagsKey, dueKey ],
						layout: {
							density: 'compact',
							styles: {
								[ tagsKey ]: {
									width: 80,
									minWidth: 80,
									maxWidth: 80,
								},
								[ dueKey ]: {
									width: 96,
									minWidth: 96,
									maxWidth: 96,
								},
							},
						},
					} ),
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
			await expect(
				canvas.getByText( 'Resize overlap row' )
			).toBeVisible();
			await assertContained( canvas );

			await page.evaluate( async () => {
				await window.wp.data.dispatch( 'core/editor' ).savePost();
			} );
			await page.waitForFunction(
				() => ! window.wp.data.select( 'core/editor' ).isSavingPost()
			);

			await page.reload();
			await expect(
				canvas.getByText( 'Resize overlap row' )
			).toBeVisible();
			await assertContained( canvas );
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
			for ( const fieldId of fixture.fieldIds ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_fields/${ fieldId }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );

	test( 'reorders columns via drag and persists the order across reload', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = { fieldIds: [] };

		try {
			const suffix = Date.now().toString( 36 ).slice( -4 );
			const slug = `e2eorder${ suffix }`;
			fixture.slug = slug;

			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: `Reorder ${ suffix }`,
					status: 'private',
					meta: { slug },
				},
			} );

			const createField = async ( title ) => {
				const f = await requestUtils.rest( {
					method: 'POST',
					path: '/wp/v2/crtxt_fields',
					data: { title, status: 'private', meta: { type: 'text' } },
				} );
				fixture.fieldIds.push( f.id );
				return f;
			};

			const fieldA = await createField( 'Author' );
			const fieldB = await createField( 'Notes' );

			await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_collections/${ fixture.collection.id }`,
				data: {
					meta: { fields: fixture.fieldIds.map( String ) },
				},
			} );

			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ slug }`,
				data: {
					title: 'Sample',
					status: 'private',
					meta: {
						[ `field-${ fieldA.id }` ]: 'Author A',
						[ `field-${ fieldB.id }` ]: 'Notes B',
					},
				},
			} );

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'Column reorder persistence page',
					status: 'private',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [
							'title',
							`field-${ fieldA.id }`,
							`field-${ fieldB.id }`,
						],
					} ),
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
			const headerButton = ( name ) =>
				canvas
					.locator( '.dataviews-view-table-header-button' )
					.filter( { hasText: name } );
			await expect( headerButton( 'Author' ) ).toBeVisible();
			await expect( headerButton( 'Notes' ) ).toBeVisible();

			// The entire header is the drag area. Pick a point on the
			// Author header that's well clear of the right-edge resizer
			// (~6px), then drag past the midpoint of the Notes header so
			// Author lands after Notes. Author is index 1 (title is 0).
			const authorTh = canvas
				.locator( '.dataviews-view-table thead > tr > th' )
				.nth( 1 );
			const authorBox = await authorTh.boundingBox();
			const notesTh = canvas
				.locator( '.dataviews-view-table thead > tr > th' )
				.nth( 2 );
			const notesBox = await notesTh.boundingBox();
			const notesCell = canvas
				.locator( '.dataviews-view-table tbody > tr' )
				.first()
				.locator( 'td' )
				.nth( 2 );
			const notesCellBox = await notesCell.boundingBox();

			const startX = authorBox.x + 20;
			const startY = authorBox.y + authorBox.height / 2;
			await page.mouse.move( startX, startY );
			await page.mouse.down();
			await page.mouse.move( startX + 10, startY, { steps: 4 } );
			await expect(
				canvas.locator( '.cortext-column-drag-preview' )
			).toContainText( 'Author' );
			await page.mouse.move(
				notesBox.x + notesBox.width * 0.75,
				notesBox.y + notesBox.height / 2,
				{ steps: 10 }
			);
			await expect
				.poll( async () => {
					const box = await notesTh.boundingBox();
					return box.x;
				} )
				.toBeLessThan( notesBox.x - 20 );
			const notesTransform = await notesTh.evaluate(
				( el ) => el.style.transform
			);
			expect( notesTransform ).toContain( 'translateX' );
			await page.mouse.move(
				notesBox.x + notesBox.width * 0.7,
				notesBox.y + notesBox.height / 2,
				{ steps: 4 }
			);
			await expect(
				notesTh.evaluate( ( el ) => el.style.transform )
			).resolves.toBe( notesTransform );
			await page.mouse.move(
				notesBox.x + notesBox.width * 0.8,
				notesBox.y + notesBox.height / 2,
				{ steps: 4 }
			);
			await expect(
				notesTh.evaluate( ( el ) => el.style.transform )
			).resolves.toBe( notesTransform );
			const notesCellDragBox = await notesCell.boundingBox();
			expect(
				Math.abs( notesCellDragBox.x - notesCellBox.x )
			).toBeLessThan( 1 );
			await page.mouse.up();

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

			const orderMatch = saved.content.raw.match(
				/"fields":\[([^\]]+)\]/
			);
			expect( orderMatch ).not.toBeNull();
			const fieldOrder = orderMatch[ 1 ]
				.split( ',' )
				.map( ( s ) => s.trim().replace( /"/g, '' ) );
			expect( fieldOrder.indexOf( `field-${ fieldB.id }` ) ).toBeLessThan(
				fieldOrder.indexOf( `field-${ fieldA.id }` )
			);

			await page.reload();
			await expect( headerButton( 'Notes' ) ).toBeVisible();

			const headerLabels = await canvas
				.locator(
					'.dataviews-view-table thead > tr > th .dataviews-view-table-header-button'
				)
				.allTextContents();
			const notesIndex = headerLabels.findIndex( ( t ) =>
				t.includes( 'Notes' )
			);
			const authorIndex = headerLabels.findIndex( ( t ) =>
				t.includes( 'Author' )
			);
			expect( notesIndex ).toBeGreaterThan( -1 );
			expect( authorIndex ).toBeGreaterThan( -1 );
			expect( notesIndex ).toBeLessThan( authorIndex );
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
			for ( const fieldId of fixture.fieldIds ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_fields/${ fieldId }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
		}
	} );
	test( 'creates, renames, duplicates, and deletes fields without leaving the block', async ( {
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
					title: 'Field management page',
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
			await expect( canvas.getByText( 'Author' ) ).toBeVisible();

			// Select the data-view block so its toolbar (with Add field) renders.
			// Clicking the canvas content tends to land on one of our
			// interactive controls (column header dropdown, etc.) and
			// open a popover instead of selecting the block; dispatch
			// directly through core-data to avoid that. Pages now also carry
			// locked header blocks, so pick the data-view block by name instead
			// of assuming it is the first block.
			await page.evaluate( () => {
				const blocks = window.wp.data
					.select( 'core/block-editor' )
					.getBlocks();
				const dataViewBlock = blocks.find(
					( block ) => block.name === 'cortext/data-view'
				);
				if ( dataViewBlock ) {
					window.wp.data
						.dispatch( 'core/block-editor' )
						.selectBlock( dataViewBlock.clientId );
				}
			} );

			// 1. Toolbar Add field: create a "Notes" text field. The
			//    popover follows Notion's click-to-create model, so
			//    picking a type submits.
			await page
				.getByRole( 'button', { name: 'Add field', exact: true } )
				.first()
				.click();
			const popover = page.locator(
				'.cortext-data-view-toolbar-popover'
			);
			await popover.getByLabel( 'Name' ).fill( 'Notes' );
			await popover
				.getByRole( 'button', { name: 'Text', exact: true } )
				.click();

			const notesHeader = canvas.getByRole( 'columnheader', {
				name: /Notes/,
			} );
			await expect( notesHeader ).toBeVisible();

			// `getByRole('button', { name })` would match both the visible
			// combined-dropdown trigger (text label) and the transparent
			// drag-handle overlay (aria-label = field name); filter by
			// visible text to pick the trigger. The drag handle stacks
			// above the trigger to capture drag, and forwards click
			// events via JS — Playwright's strict click would flag the
			// handle as intercepting, so click via dispatchEvent.
			const openColumnDropdown = async ( scope, name ) => {
				const button = scope
					.getByRole( 'button', { name } )
					.filter( { hasText: name } );
				await button.dispatchEvent( 'click' );
			};
			const columnMenuItem = ( name ) =>
				canvas.getByRole( 'menuitem', { name } );

			// 2. Rename "Notes" → "Description" via the column-header
			//    dropdown (combined Sort/Move/Hide + Rename/Duplicate/
			//    Delete menu — see docs/tech-debt.md#16).
			await openColumnDropdown( notesHeader, 'Notes' );
			await columnMenuItem( 'Rename' ).click();

			const renameInput = canvas.getByLabel( 'Field name' );
			await renameInput.fill( 'Description' );
			await renameInput.press( 'Enter' );

			await expect(
				canvas.getByRole( 'columnheader', { name: /Description/ } )
			).toBeVisible();
			await expect(
				canvas.getByRole( 'columnheader', { name: /^Notes$/ } )
			).toHaveCount( 0 );

			// 3. Duplicate "Description" → "Copy of Description".
			await openColumnDropdown( canvas, 'Description' );
			await columnMenuItem( 'Duplicate' ).click();

			await expect(
				canvas.getByRole( 'columnheader', {
					name: /Copy of Description/,
				} )
			).toBeVisible();

			// 4. Delete "Copy of Description" via the dropdown + confirm
			//    dialog.
			await openColumnDropdown( canvas, 'Copy of Description' );
			await columnMenuItem( 'Delete' ).click();
			await page
				.getByRole( 'button', { name: 'Delete', exact: true } )
				.click();

			await expect(
				canvas.getByRole( 'columnheader', {
					name: /Copy of Description/,
				} )
			).toHaveCount( 0 );

			// 5. Ghost column `+` opens the same popover and creates a field.
			const ghostAdd = canvas
				.locator( 'th' )
				.last()
				.getByRole( 'button', { name: 'Add field' } );
			await ghostAdd.click();
			const ghostPopover = page.locator(
				'.cortext-data-view-toolbar-popover'
			);
			await ghostPopover.getByLabel( 'Name' ).fill( 'Tags' );
			await ghostPopover
				.getByRole( 'button', { name: 'Text', exact: true } )
				.click();

			await expect(
				canvas.getByRole( 'columnheader', { name: /Tags/ } )
			).toBeVisible();

			// 6. Title's column doesn't get the schema-action takeover —
			//    its `<th>` keeps DataViews' built-in trigger and has no
			//    Cortext combined-dropdown trigger.
			await expect(
				canvas
					.getByRole( 'columnheader', { name: 'Title' } )
					.locator( '.cortext-column-header-trigger' )
			).toHaveCount( 0 );
		} finally {
			// Best-effort cleanup. The created/duplicated fields aren't
			// tracked individually, but they cascade with their
			// collection's force-delete (and the server cleanup hook
			// removes their entry meta).
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
