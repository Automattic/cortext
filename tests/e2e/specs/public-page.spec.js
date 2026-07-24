/**
 * E2E tests for public page rendering.
 *
 * A published page document should be reachable at /cortext/{slug}/ by an
 * unauthenticated visitor; a private page should 404.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const {
	clearWordPressAuthCookies,
	withExpectedConsoleError,
} = require( '../utils' );

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
		// Best-effort cleanup.
	}
}

async function createPublishedCollection( requestUtils, title ) {
	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			title,
			status: 'publish',
		},
	} );

	const field = await requestUtils.rest( {
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
		path: `/wp/v2/crtxt_documents/${ collection.id }`,
		data: {
			meta: { cortext_fields: [ String( field.id ) ] },
		},
	} );

	return { collection, field };
}

function createDataViewBlockMarkup( collectionId, viewOverrides = {} ) {
	const attributes = {
		collectionId,
		view: {
			type: 'table',
			fields: [ 'title' ],
			sort: null,
			filters: [],
			perPage: 25,
			page: 1,
			search: '',
			layout: { density: 'compact' },
			...viewOverrides,
		},
	};

	return `<!-- wp:cortext/data-view ${ JSON.stringify( attributes ) } /-->`;
}

async function createPublishedCollectionWithRows( requestUtils ) {
	const suffix = Date.now().toString( 36 ).slice( -4 );

	const { collection, field } = await createPublishedCollection(
		requestUtils,
		`Public DataView order ${ suffix }`
	);

	const rows = [];
	for ( const { title, notes } of [
		{
			title: 'Alpha Public Manual',
			notes: 'needle visible note',
		},
		{
			title: 'Beta Public Manual',
			notes: 'needle archived note',
		},
		{
			title: 'Gamma Public Manual',
			notes: 'plain visible note',
		},
	] ) {
		rows.push(
			await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title,
					status: 'private',
					cortext_trait: collection.id,
					meta: {
						[ `field-${ field.id }` ]: notes,
					},
				},
			} )
		);
	}

	return { collection, field, rows };
}

async function renderedPublicTitles( page, titles ) {
	const rendered = [];

	for ( const title of titles ) {
		const locator = page.getByText( title, { exact: true } ).first();
		await expect( locator ).toBeVisible();
		const box = await locator.boundingBox();
		expect( box ).toBeTruthy();
		rendered.push( {
			title,
			x: Math.round( box.x ),
			y: Math.round( box.y ),
		} );
	}

	return rendered
		.sort( ( a, b ) => a.y - b.y || a.x - b.x )
		.map( ( item ) => item.title );
}

test.describe( 'Public page rendering', () => {
	test( 'published page is accessible to anonymous visitors', async ( {
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const title = `Public page ${ suffix }`;
		const bodyText = `Hello from a public Cortext page ${ suffix }`;
		let createdPage;

		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title,
					status: 'publish',
					content: `<!-- wp:paragraph -->\n<p>${ bodyText }</p>\n<!-- /wp:paragraph -->`,
				},
			} );

			await clearWordPressAuthCookies( page.context() );
			const response = await page.goto(
				`/cortext/${ createdPage.slug }/`
			);

			expect( response?.status() ).toBe( 200 );
			await expect( page.locator( 'h1' ) ).toHaveText( title );
			await expect(
				page.locator( 'p' ).getByText( bodyText )
			).toBeVisible();
		} finally {
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_documents/${ createdPage.id }`
			);
		}
	} );

	test( 'published page hides the WordPress admin bar for logged-in visitors', async ( {
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		let createdPage;

		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `Public page while logged in ${ suffix }`,
					status: 'publish',
				},
			} );

			const response = await page.goto(
				`/cortext/${ createdPage.slug }/`
			);

			expect( response?.status() ).toBe( 200 );
			await expect( page.locator( '#wpadminbar' ) ).toHaveCount( 0 );
		} finally {
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_documents/${ createdPage.id }`
			);
		}
	} );

	test( 'published DataView renders manual row order for anonymous visitors', async ( {
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		const consoleErrors = [];
		const pageErrors = [];
		const onConsole = ( message ) => {
			if ( message.type() === 'error' ) {
				consoleErrors.push( message.text() );
			}
		};
		const onPageError = ( error ) => pageErrors.push( error.message );

		page.on( 'console', onConsole );
		page.on( 'pageerror', onPageError );

		try {
			Object.assign(
				fixture,
				await createPublishedCollectionWithRows( requestUtils )
			);

			const [ alpha, , gamma ] = fixture.rows;
			await requestUtils.rest( {
				method: 'POST',
				path: `/cortext/v1/documents/${ gamma.id }/reorder`,
				data: {
					before_id: alpha.id,
					after_id: null,
					current_sort: null,
				},
			} );

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `Public DataView page ${ Date.now()
						.toString( 36 )
						.slice( -4 ) }`,
					status: 'publish',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: null,
						fieldsByType: { grid: null, list: 'field-11' },
						layoutByType: 'invalid',
					} ),
				},
			} );

			await page.context().clearCookies( { name: /^wordpress_/ } );

			const response = await page.goto(
				`/cortext/${ fixture.page.slug }/`
			);

			expect( response?.status() ).toBe( 200 );
			await expect(
				page.locator( '.wp-block-cortext-data-view .dataviews-wrapper' )
			).toBeVisible();

			// Read-only: the search, filter, and configuration toolbar is
			// not rendered for visitors.
			await expect(
				page.locator(
					'.wp-block-cortext-data-view .dataviews__view-actions'
				)
			).toHaveCount( 0 );
			await expect
				.poll( () =>
					renderedPublicTitles( page, [
						'Alpha Public Manual',
						'Beta Public Manual',
						'Gamma Public Manual',
					] )
				)
				.toEqual( [
					'Gamma Public Manual',
					'Alpha Public Manual',
					'Beta Public Manual',
				] );
			expect( pageErrors ).toEqual( [] );
			expect(
				consoleErrors.filter(
					( message ) => ! /favicon/i.test( message )
				)
			).toEqual( [] );
		} finally {
			page.off( 'console', onConsole );
			page.off( 'pageerror', onPageError );
			for ( const row of fixture.rows ?? [] ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_documents/${ row.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_documents/${ fixture.page.id }`
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

	test( 'published DataView applies saved search and filters for anonymous visitors', async ( {
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			Object.assign(
				fixture,
				await createPublishedCollectionWithRows( requestUtils )
			);

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `Public filtered DataView ${ Date.now()
						.toString( 36 )
						.slice( -4 ) }`,
					status: 'publish',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title', `field-${ fixture.field.id }` ],
						search: 'needle',
						filters: [
							{
								field: `field-${ fixture.field.id }`,
								operator: 'contains',
								value: 'visible',
							},
						],
					} ),
				},
			} );

			await page.context().clearCookies( { name: /^wordpress_/ } );

			const response = await page.goto(
				`/cortext/${ fixture.page.slug }/`
			);

			expect( response?.status() ).toBe( 200 );
			await expect(
				page.getByText( 'Alpha Public Manual', { exact: true } )
			).toBeVisible();
			await expect(
				page.getByText( 'Beta Public Manual', { exact: true } )
			).toBeHidden();
			await expect(
				page.getByText( 'Gamma Public Manual', { exact: true } )
			).toBeHidden();
		} finally {
			for ( const row of fixture.rows ?? [] ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_documents/${ row.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_documents/${ fixture.page.id }`
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

	test( 'keeps an unsized public title column within a mobile viewport', async ( {
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			Object.assign(
				fixture,
				await createPublishedCollectionWithRows( requestUtils )
			);

			fixture.page = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `Public mobile DataView ${ Date.now()
						.toString( 36 )
						.slice( -4 ) }`,
					status: 'publish',
					content: createDataViewBlockMarkup( fixture.collection.id, {
						fields: [ 'title' ],
					} ),
				},
			} );

			await page.setViewportSize( { width: 320, height: 800 } );
			await clearWordPressAuthCookies( page.context() );
			const response = await page.goto(
				`/cortext/${ fixture.page.slug }/`
			);

			expect( response?.status() ).toBe( 200 );
			const dataView = page.locator( '.wp-block-cortext-data-view' );
			await expect( dataView ).toBeVisible();
			await expect(
				page.getByText( 'Alpha Public Manual', { exact: true } )
			).toBeVisible();

			const widths = await dataView.evaluate( ( element ) => ( {
				clientWidth: element.clientWidth,
				scrollWidth: element.scrollWidth,
			} ) );
			expect( widths.clientWidth ).toBeGreaterThan( 0 );
			expect( widths.scrollWidth ).toBeLessThanOrEqual(
				widths.clientWidth + 1
			);
		} finally {
			for ( const row of fixture.rows ?? [] ) {
				await deleteIfCreated(
					requestUtils,
					`/wp/v2/crtxt_documents/${ row.id }`
				);
			}
			await deleteIfCreated(
				requestUtils,
				fixture.page && `/wp/v2/crtxt_documents/${ fixture.page.id }`
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

	test( 'private page returns 404 for anonymous visitors', async ( {
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		let createdPage;

		await withExpectedConsoleError(
			/the server responded with a status of 404/,
			async () => {
				try {
					createdPage = await requestUtils.rest( {
						method: 'POST',
						path: '/wp/v2/crtxt_documents',
						data: {
							title: `Private page ${ suffix }`,
							status: 'private',
						},
					} );

					await clearWordPressAuthCookies( page.context() );
					const response = await page.goto(
						`/cortext/${ createdPage.slug }/`
					);

					expect( response?.status() ).toBe( 404 );
				} finally {
					await deleteIfCreated(
						requestUtils,
						createdPage &&
							`/wp/v2/crtxt_documents/${ createdPage.id }`
					);
				}
			}
		);
	} );
} );
