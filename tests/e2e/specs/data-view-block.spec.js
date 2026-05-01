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

function createDataViewBlockMarkup( collectionId, viewOverrides = {} ) {
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

			// Select: chip with the option's color (Notion shape parsed).
			const statusChip = canvas.getByText( 'Open', { exact: true } );
			await expect( statusChip ).toBeVisible();
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
				.locator( '.dataviews-view-table-header-button' )
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

			// 2. Rename "Notes" → "Description" via the column-header
			//    dropdown (combined Sort/Move/Hide + Rename/Duplicate/
			//    Delete menu — see docs/tech-debt.md#16).
			await notesHeader.getByRole( 'button', { name: 'Notes' } ).click();
			await page.getByRole( 'menuitem', { name: 'Rename' } ).click();

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
			await canvas.getByRole( 'button', { name: 'Description' } ).click();
			await page.getByRole( 'menuitem', { name: 'Duplicate' } ).click();

			await expect(
				canvas.getByRole( 'columnheader', {
					name: /Copy of Description/,
				} )
			).toBeVisible();

			// 4. Delete "Copy of Description" via the dropdown + confirm
			//    dialog.
			await canvas
				.getByRole( 'button', { name: 'Copy of Description' } )
				.click();
			await page.getByRole( 'menuitem', { name: 'Delete' } ).click();
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

			// 6. Title's column header opens DataViews' built-in dropdown
			//    (sort/hide/move). It does not surface schema actions
			//    like Rename — the takeover only applies to custom fields.
			await canvas.getByRole( 'button', { name: 'Title' } ).click();
			await expect(
				page.getByRole( 'menuitem', { name: 'Rename' } )
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
