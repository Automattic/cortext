/**
 * UI perf checks for Cortext.
 *
 * Skipped by default. Set CORTEXT_PERF_UI=1 to run them. At the end, the suite
 * writes `artifacts/perf-ui.json` so CI can save it for comparison runs.
 *
 * Scenarios:
 *   - collection_ready_basic: seeded collection open to first painted rows.
 *   - collection_ready_rollups: page 3 of the same collection, where rollups
 *     are heavier.
 *   - row_detail_ready: first row's Open button to detail view ready.
 *   - row_create_ready: New row click through POST and rendered row.
 *   - sort_apply: open the first column header menu, choose "Sort
 *     ascending", wait for sorted rows.
 *   - page_edit_ready: crtxt_page in Gutenberg until the editor is mounted.
 *   - command_palette_open: shell event to command palette mount.
 *   - column_actions_open: column header trigger to visible menu.
 *   - column_rename_inline: open the column menu, choose "Rename", type a new
 *     name, press Enter, then wait for the save to finish.
 *   - workspace_home_ready: root Cortext URL until sidebar and home content render.
 *   - shell_navigation_warm: sidebar navigation from one loaded collection to another.
 *   - search_rows_ready: DataView search input to filtered rows.
 *   - row_navigate_next: "Row below" click in full row detail to the next row.
 */

const { test } = require( '@wordpress/e2e-test-utils-playwright' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { resolveCollectionAdminUrl } = require( '../perf-fixtures' );

const COLLECTION_SLUG = 'perfmain';
const READY_TIMEOUT_MS = 30_000;
const ROWS_API_SEGMENT = '/cortext/v1/rows';
const REST_SEGMENTS = [ '/cortext/v1/', '/wp/v2/', '/wp-json/' ];

// Tag a measured scenario with the category the renderer groups it under.
// Categories: collection_read, row, column, navigation, surface.
const tag = ( category, metrics ) => ( { category, ...metrics } );

const PERF_PAGE_CONTENT =
	'<!-- wp:heading -->\n<h2>Cortext perf page</h2>\n<!-- /wp:heading -->\n\n<!-- wp:paragraph -->\n<p>Filler paragraph one.</p>\n<!-- /wp:paragraph -->\n\n<!-- wp:paragraph -->\n<p>Filler paragraph two.</p>\n<!-- /wp:paragraph -->';

test.describe( 'Cortext UI performance', () => {
	test.skip(
		process.env.CORTEXT_PERF_UI !== '1',
		'Set CORTEXT_PERF_UI=1 to run the UI performance specs.'
	);

	// Keep this file serial. The shared `scenarios` object is written once in
	// `afterAll`; parallel workers would each write their own partial artifact.
	test.describe.configure( { mode: 'serial' } );

	const scenarios = {};
	let collection;
	let perfPage;

	test.beforeAll( async ( { requestUtils } ) => {
		collection = await resolveCollectionAdminUrl(
			requestUtils,
			COLLECTION_SLUG
		);

		perfPage = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/crtxt_pages',
			data: {
				title: 'Cortext perf page',
				status: 'private',
				content: PERF_PAGE_CONTENT,
			},
		} );
	} );

	test.afterAll( async ( { requestUtils } ) => {
		if ( perfPage?.id ) {
			try {
				await requestUtils.rest( {
					method: 'DELETE',
					path: `/wp/v2/crtxt_pages/${ perfPage.id }`,
					params: { force: true },
				} );
			} catch {
				// Cleanup is best effort. A failed DELETE should not hide the
				// perf numbers.
			}
		}

		const outDir = path.resolve( process.cwd(), 'artifacts' );
		fs.mkdirSync( outDir, { recursive: true } );
		fs.writeFileSync(
			path.join( outDir, 'perf-ui.json' ),
			JSON.stringify(
				{
					version: 1,
					collection: collection
						? { slug: COLLECTION_SLUG, id: collection.id }
						: null,
					scenarios,
				},
				null,
				2
			),
			'utf-8'
		);
	} );

	test( 'collection_ready_basic', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		const startedAt = Date.now();
		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		scenarios.collection_ready_basic = tag(
			'collection_read',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'collection_ready_rollups', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		const previousFirstRow = await readFirstRowText( page );

		await probe.reset();
		const responsePromise = page.waitForResponse(
			( response ) =>
				response.url().includes( ROWS_API_SEGMENT ) &&
				response.url().includes( 'page=3' ),
			{ timeout: READY_TIMEOUT_MS }
		);
		const startedAt = Date.now();

		await page.getByLabel( 'Current page' ).selectOption( '3' );
		await responsePromise;
		await waitForFirstRowChanged( page, previousFirstRow );
		await waitForPaint( page );

		scenarios.collection_ready_rollups = tag(
			'collection_read',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'row_detail_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		await probe.reset();
		const startedAt = Date.now();

		await page.getByLabel( 'Open row' ).first().click( { force: true } );
		await waitForRowDetailReady( page );

		scenarios.row_detail_ready = tag(
			'row',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'row_create_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		const previousCount = await readRowCount( page );

		await probe.reset();
		const createPromise = page.waitForResponse(
			( response ) =>
				response.request().method() === 'POST' &&
				response.url().includes( `/wp/v2/crtxt_${ COLLECTION_SLUG }` ),
			{ timeout: READY_TIMEOUT_MS }
		);
		const startedAt = Date.now();

		await page.locator( '.cortext-data-view__new-row' ).click();
		await createPromise;
		await waitForRowCountChanged( page, previousCount );
		await waitForPaint( page );

		scenarios.row_create_ready = tag(
			'row',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'sort_apply', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		const previousFirstRow = await readFirstRowText( page );

		await probe.reset();
		const responsePromise = page.waitForResponse(
			( response ) =>
				response.url().includes( ROWS_API_SEGMENT ) &&
				response.url().includes( 'sort' ),
			{ timeout: READY_TIMEOUT_MS }
		);
		const startedAt = Date.now();

		await page
			.locator( 'button.dataviews-view-table-header-button' )
			.first()
			.click( { force: true } );
		// Title rows are zero-padded "Perf Primary Row NNNNN", so ascending
		// matches the default oldest-first order; descending swaps the first
		// row from 00001 to 01250 and gives a stable readiness signal.
		await page
			.getByRole( 'menuitemradio', { name: 'Sort descending' } )
			.click();
		await responsePromise;
		await waitForFirstRowChanged( page, previousFirstRow );
		await waitForPaint( page );

		scenarios.sort_apply = tag(
			'collection_read',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'page_edit_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		const startedAt = Date.now();
		await admin.visitAdminPage(
			'admin.php',
			`page=cortext&p=/${ perfPage.id }`
		);
		await waitForEditorReady( page, perfPage.id );

		scenarios.page_edit_ready = tag(
			'surface',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'column_actions_open', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		await probe.reset();
		const startedAt = Date.now();

		await page
			.locator( 'button.cortext-column-header-trigger' )
			.first()
			.click( { force: true } );
		await page
			.getByRole( 'menu' )
			.first()
			.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );

		scenarios.column_actions_open = tag(
			'column',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'column_rename_inline', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		await page
			.locator( 'button.cortext-column-header-trigger' )
			.first()
			.click( { force: true } );
		await page.getByRole( 'menuitem', { name: 'Rename' } ).click();
		const renameInput = page.locator(
			'.cortext-rename-field-inline input'
		);
		await renameInput.waitFor( {
			state: 'visible',
			timeout: READY_TIMEOUT_MS,
		} );

		await probe.reset();
		const startedAt = Date.now();

		await renameInput.fill( `Perf renamed ${ Date.now() }` );
		await renameInput.press( 'Enter' );
		await page
			.locator( '.cortext-rename-field-inline' )
			.waitFor( { state: 'hidden', timeout: READY_TIMEOUT_MS } );
		await waitForPaint( page );

		scenarios.column_rename_inline = tag(
			'column',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'command_palette_open', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		await probe.reset();
		const startedAt = Date.now();

		await page.evaluate( () => {
			window.dispatchEvent( new Event( 'cortext:open-command-palette' ) );
		} );
		await waitForCommandPaletteReady( page );

		scenarios.command_palette_open = tag(
			'surface',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'workspace_home_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		const responsePromise = page.waitForResponse(
			( response ) =>
				response.url().includes( '/cortext/v1/workspace-home' ),
			{ timeout: READY_TIMEOUT_MS }
		);
		const startedAt = Date.now();

		await admin.visitAdminPage( 'admin.php', 'page=cortext' );
		await responsePromise;
		await page
			.locator( '.cortext-sidebar' )
			.first()
			.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
		await waitForPaint( page );

		scenarios.workspace_home_ready = tag(
			'navigation',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'shell_navigation_warm', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		const previousFirstRow = await readFirstRowText( page );

		await probe.reset();
		const responsePromise = page.waitForResponse(
			( response ) =>
				response.url().includes( ROWS_API_SEGMENT ) &&
				! response.url().includes( `collection=${ collection.id }` ),
			{ timeout: READY_TIMEOUT_MS }
		);
		const startedAt = Date.now();

		await page
			.locator( '.cortext-sidebar' )
			.getByRole( 'button', { name: 'Perf Target 1', exact: true } )
			.click();
		await responsePromise;
		await waitForFirstRowChanged( page, previousFirstRow );
		await waitForPaint( page );

		scenarios.shell_navigation_warm = tag(
			'navigation',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'search_rows_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		const previousFirstRow = await readFirstRowText( page );

		await probe.reset();
		const responsePromise = page.waitForResponse(
			( response ) =>
				response.url().includes( ROWS_API_SEGMENT ) &&
				response.url().includes( 'search=' ),
			{ timeout: READY_TIMEOUT_MS }
		);
		const startedAt = Date.now();

		// Search for the last seeded row's suffix so the result set shrinks
		// to one entry whose title differs from the unfiltered first row.
		// 'Perf' would match every row and leave the first row unchanged.
		await page.locator( '.dataviews-search input' ).fill( '01250' );
		await responsePromise;
		await waitForFirstRowChanged( page, previousFirstRow );
		await waitForPaint( page );

		scenarios.search_rows_ready = tag(
			'collection_read',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'row_navigate_next', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );
		await page.getByLabel( 'Open row' ).first().click( { force: true } );
		await waitForRowDetailReady( page );

		const previousTitle = await page
			.locator( '.cortext-row-detail__title' )
			.first()
			.textContent();

		await probe.reset();
		const startedAt = Date.now();

		await page.getByLabel( 'Row below' ).click();
		await page.waitForFunction(
			( prev ) => {
				const el = document.querySelector(
					'.cortext-row-detail__title'
				);
				return Boolean( el ) && el.textContent !== prev;
			},
			previousTitle,
			{ timeout: READY_TIMEOUT_MS }
		);
		await waitForPaint( page );

		scenarios.row_navigate_next = tag(
			'row',
			await probe.snapshot( startedAt )
		);
	} );
} );

async function setupProbe( page ) {
	await page.addInitScript( () => {
		window.__cortextPerfLongTasks = [];
		try {
			new PerformanceObserver( ( list ) => {
				for ( const entry of list.getEntries() ) {
					window.__cortextPerfLongTasks.push( entry.duration );
				}
			} ).observe( { entryTypes: [ 'longtask' ] } );
		} catch {
			// Some browsers do not expose `longtask` entries. An empty array
			// reports this as 0 below.
		}
	} );

	const requests = [];
	// Track request and response timestamps with the request object. In this
	// wp-env setup, `request.timing()` often returns -1 for cached or kept-alive
	// requests.
	const requestStarts = new WeakMap();
	page.on( 'request', ( request ) => {
		requestStarts.set( request, Date.now() );
	} );
	page.on( 'response', ( response ) => {
		const url = response.url();
		if ( ! REST_SEGMENTS.some( ( segment ) => url.includes( segment ) ) ) {
			return;
		}
		const start = requestStarts.get( response.request() );
		const duration = start ? Date.now() - start : null;
		requests.push( { url, duration } );
	} );

	const resetLongTasks = async () => {
		try {
			await page.evaluate( () => {
				window.__cortextPerfLongTasks = [];
			} );
		} catch {
			// Before first navigation, there may not be a document yet. The init
			// script sets the array on the next one.
		}
	};

	return {
		async reset() {
			requests.length = 0;
			await resetLongTasks();
		},
		async snapshot( startedAt ) {
			const readyMs = Date.now() - startedAt;
			const rowsCall = requests.find( ( entry ) =>
				entry.url.includes( ROWS_API_SEGMENT )
			);
			const tasks = await page.evaluate(
				() => window.__cortextPerfLongTasks ?? []
			);
			const longTasks = Array.isArray( tasks ) ? tasks : [];

			return {
				ready_ms: readyMs,
				rows_api_ms: rowsCall?.duration ?? null,
				rest_request_count: requests.length,
				long_task_total_ms: longTasks.reduce(
					( total, duration ) => total + duration,
					0
				),
				long_task_max_ms: longTasks.reduce(
					( max, duration ) => Math.max( max, duration ),
					0
				),
			};
		},
	};
}

async function waitForCollectionReady( page ) {
	await page
		.locator( '.cortext-data-view .dataviews-wrapper' )
		.first()
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	await page
		.locator( 'tbody tr.dataviews-view-table__row' )
		.first()
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	await waitForPaint( page );
}

async function readFirstRowText( page ) {
	return page.evaluate(
		() =>
			document.querySelector( 'tbody tr.dataviews-view-table__row' )
				?.textContent ?? null
	);
}

async function readRowCount( page ) {
	return page.evaluate(
		() =>
			document.querySelectorAll( 'tbody tr.dataviews-view-table__row' )
				.length
	);
}

async function waitForFirstRowChanged( page, previousText ) {
	await page.waitForFunction(
		( prev ) => {
			const row = document.querySelector(
				'tbody tr.dataviews-view-table__row'
			);
			return Boolean( row ) && row.textContent !== prev;
		},
		previousText,
		{ timeout: READY_TIMEOUT_MS }
	);
}

async function waitForRowCountChanged( page, previousCount ) {
	await page.waitForFunction(
		( prev ) => {
			const count = document.querySelectorAll(
				'tbody tr.dataviews-view-table__row'
			).length;
			return count !== prev && count > 0;
		},
		previousCount,
		{ timeout: READY_TIMEOUT_MS }
	);
}

async function waitForRowDetailReady( page ) {
	await page
		.locator( '.cortext-row-detail__frame' )
		.first()
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	await page
		.locator( '.cortext-row-detail__title' )
		.first()
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	await waitForPaint( page );
}

async function waitForCommandPaletteReady( page ) {
	await page
		.locator( '.commands-command-menu' )
		.first()
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	await waitForPaint( page );
}

async function waitForEditorReady( page, postId ) {
	await page.waitForFunction(
		( id ) =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.() ===
			id,
		postId,
		{ timeout: READY_TIMEOUT_MS }
	);
	await waitForPaint( page );
}

async function waitForPaint( page ) {
	await page.evaluate(
		() =>
			new Promise( ( resolve ) => {
				window.requestAnimationFrame( () =>
					window.requestAnimationFrame( resolve )
				);
			} )
	);
}
