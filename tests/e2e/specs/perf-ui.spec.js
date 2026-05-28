/**
 * UI perf checks for Cortext.
 *
 * Skipped by default. Set CORTEXT_PERF_UI=1 to run them. The suite runs each
 * scenario PERF_UI_ITERATIONS times (default 5, override with
 * CORTEXT_PERF_UI_ITERATIONS) and reports p50 / p95 / MAD for each metric.
 * It writes `artifacts/perf-ui.json` at the end so CI can save it for
 * comparison runs.
 *
 * Scenarios:
 *   - collection_ready_basic: seeded collection open to first painted rows.
 *   - collection_ready_rollups: page 3 of the same collection, where rollups
 *     are heavier.
 *   - row_detail_ready: first row's Open button to detail view ready.
 *   - row_create_ready: New row click through POST and rendered row.
 *   - sort_apply: open the first column header menu, choose "Sort
 *     ascending", wait for sorted rows.
 *   - page_edit_ready: page document in Gutenberg until the editor is mounted.
 *   - command_palette_open: shell event to command palette mount.
 *   - palette_search_ready: command palette search from typing to the first
 *     document result from /cortext/v1/documents.
 *   - column_actions_open: column header trigger to visible menu.
 *   - column_rename_inline: open the column menu, choose "Rename", type a new
 *     name, press Enter, then wait for the save to finish.
 *   - workspace_home_ready: root Cortext URL until sidebar and home content render.
 *   - shell_navigation_warm: sidebar navigation from one loaded collection to another.
 *   - search_rows_ready: DataView search input to filtered rows.
 *   - row_navigate_next: "Row below" click in full row detail to the next row.
 */

const { expect, test } = require( '@wordpress/e2e-test-utils-playwright' );
const fs = require( 'node:fs' );
const path = require( 'node:path' );
const { resolveCollectionAdminUrl } = require( '../perf-fixtures' );

const COLLECTION_SLUG = 'perfmain';
const READY_TIMEOUT_MS = 30_000;
const ROWS_API_SEGMENT = '/cortext/v1/rows';
const REST_SEGMENTS = [ '/cortext/v1/', '/wp/v2/', '/wp-json/' ];
const ACTIVE_WORKSPACE_PANE_SELECTOR =
	'.cortext-workspace__pane[data-active="true"]';
const ACTIVE_WORKSPACE_CANVAS_FRAME_SELECTOR = `${ ACTIVE_WORKSPACE_PANE_SELECTOR } iframe[name="editor-canvas"]`;
const ROW_DETAIL_CANVAS_FRAME_SELECTOR =
	'.cortext-row-detail__pane[data-interactive="true"] iframe[name="editor-canvas"]';
const ACTIVE_COLLECTION_VIEW_SELECTOR = '.cortext-data-view';
const DATA_VIEW_ROW_SELECTOR = 'tbody tr.dataviews-view-table__row';

// Number of samples to collect for each scenario in one workflow run. CI
// runners are noisy enough that n=1 can move by +/-50%. Override with
// CORTEXT_PERF_UI_ITERATIONS for local debugging.
const PERF_UI_ITERATIONS = Math.max(
	1,
	Number.parseInt( process.env.CORTEXT_PERF_UI_ITERATIONS ?? '5', 10 ) || 5
);

// Tag a measured scenario with the category the renderer groups it under.
// Categories: collection_read, row, column, navigation, surface.
const tag = ( category, metrics ) => ( { category, ...metrics } );

// Nearest-rank percentile, matching includes/CLI/PerfBench.php::percentile so
// JS and backend aggregates use the same method.
function percentile( values, p ) {
	if ( values.length === 0 ) {
		return null;
	}
	const sorted = [ ...values ].sort( ( a, b ) => a - b );
	const idx = Math.max(
		0,
		Math.min(
			sorted.length - 1,
			Math.ceil( ( p / 100 ) * sorted.length ) - 1
		)
	);
	return sorted[ idx ];
}

// Median absolute deviation: the noise floor used by write-perf-comment.php
// when it has enough UI samples.
function mad( values ) {
	if ( values.length === 0 ) {
		return null;
	}
	const m = percentile( values, 50 );
	return percentile(
		values.map( ( v ) => Math.abs( v - m ) ),
		50
	);
}

// Collapse iteration samples into top-level p50 values for back-compat, plus
// _p50 / _p95 / _mad / _n companions. Drop non-numeric samples per metric so
// one missing reading does not spoil the rest.
function aggregateScenario( samples ) {
	const result = { iterations: samples.length };
	if ( samples.length === 0 ) {
		return result;
	}
	const keys = new Set();
	for ( const sample of samples ) {
		for ( const key of Object.keys( sample ) ) {
			keys.add( key );
		}
	}
	for ( const key of keys ) {
		const numeric = samples
			.map( ( s ) => s[ key ] )
			.filter( ( v ) => typeof v === 'number' && Number.isFinite( v ) );
		if ( numeric.length === 0 ) {
			result[ key ] = null;
			continue;
		}
		result[ key ] = percentile( numeric, 50 );
		result[ `${ key }_p50` ] = percentile( numeric, 50 );
		result[ `${ key }_p95` ] = percentile( numeric, 95 );
		result[ `${ key }_mad` ] = mad( numeric );
		result[ `${ key }_n` ] = numeric.length;
	}
	return result;
}

// Run the scenario body PERF_UI_ITERATIONS times. Reset the probe first so
// each sample only includes its own requests and long tasks.
async function runRepeated( probe, runOnce ) {
	const samples = [];
	for ( let i = 0; i < PERF_UI_ITERATIONS; i++ ) {
		await probe.reset();
		samples.push( await runOnce() );
	}
	return aggregateScenario( samples );
}

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
			path: '/wp/v2/crtxt_documents',
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
					path: `/wp/v2/crtxt_documents/${ perfPage.id }`,
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

		scenarios.collection_ready_basic = tag(
			'collection_read',
			await runRepeated( probe, async () => {
				const startedAt = Date.now();
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );
				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'collection_ready_rollups', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.collection_ready_rollups = tag(
			'collection_read',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );
				await clearCollectionSearch( page );

				await probe.reset();
				const pageSelect =
					activeCollectionCanvas( page ).getByLabel( 'Current page' );
				const targetPage =
					( await pageSelect.inputValue() ) === '3' ? '4' : '3';
				const responsePromise = page.waitForResponse(
					( response ) =>
						response.url().includes( ROWS_API_SEGMENT ) &&
						response.url().includes( `page=${ targetPage }` ),
					{ timeout: READY_TIMEOUT_MS }
				);
				const startedAt = Date.now();

				await pageSelect.selectOption( targetPage );
				await responsePromise;
				await waitForCollectionReady( page );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'row_detail_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.row_detail_ready = tag(
			'row',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );

				await probe.reset();
				const startedAt = Date.now();

				await activeCollectionView( page )
					.getByLabel( 'Open row' )
					.first()
					.click( { force: true } );
				await waitForRowDetailReady( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'row_create_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.row_create_ready = tag(
			'row',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );

				await probe.reset();
				const createPromise = page.waitForResponse(
					( response ) =>
						response.request().method() === 'POST' &&
						response
							.url()
							.includes( `/wp/v2/crtxt_${ COLLECTION_SLUG }` ),
					{ timeout: READY_TIMEOUT_MS }
				);
				const startedAt = Date.now();

				await activeCollectionView( page )
					.locator( '.cortext-data-view__new-row' )
					.click();
				await createPromise;
				await waitForCollectionReady( page );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'sort_apply', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.sort_apply = tag(
			'collection_read',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );

				await probe.reset();
				const startedAt = Date.now();

				await activeCollectionView( page )
					.locator( 'button.dataviews-view-table-header-button' )
					.first()
					.click( { force: true } );

				const canvas = activeCollectionCanvas( page );
				const sortDescending = canvas.getByRole( 'menuitemradio', {
					name: 'Sort descending',
				} );
				const isDescending =
					( await sortDescending.getAttribute( 'aria-checked' ) ) ===
					'true';
				const nextDirection = isDescending ? 'asc' : 'desc';
				const nextLabel = isDescending
					? 'Sort ascending'
					: 'Sort descending';
				const responsePromise = page.waitForResponse(
					( response ) =>
						response.url().includes( ROWS_API_SEGMENT ) &&
						response.url().includes( 'sort' ) &&
						response.url().includes( nextDirection ),
					{ timeout: READY_TIMEOUT_MS }
				);

				await canvas
					.getByRole( 'menuitemradio', { name: nextLabel } )
					.click();
				await responsePromise;
				await waitForCollectionReady( page );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'page_edit_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.page_edit_ready = tag(
			'surface',
			await runRepeated( probe, async () => {
				const startedAt = Date.now();
				await admin.visitAdminPage(
					'admin.php',
					`page=cortext&p=/${ perfPage.id }`
				);
				await waitForEditorReady( page, perfPage.id );
				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'column_actions_open', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.column_actions_open = tag(
			'column',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );

				await probe.reset();
				const startedAt = Date.now();

				await activeCollectionView( page )
					.locator( 'button.cortext-column-header-trigger' )
					.first()
					.click( { force: true } );
				await activeCollectionCanvas( page )
					.getByRole( 'menu' )
					.first()
					.waitFor( {
						state: 'visible',
						timeout: READY_TIMEOUT_MS,
					} );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'column_rename_inline', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.column_rename_inline = tag(
			'column',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );

				await activeCollectionView( page )
					.locator( 'button.cortext-column-header-trigger' )
					.first()
					.click( { force: true } );
				const canvas = activeCollectionCanvas( page );
				await canvas
					.getByRole( 'menuitem', { name: 'Rename' } )
					.click();
				const renameInput = canvas.locator(
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
				await canvas
					.locator( '.cortext-rename-field-inline' )
					.waitFor( {
						state: 'hidden',
						timeout: READY_TIMEOUT_MS,
					} );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'command_palette_open', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.command_palette_open = tag(
			'surface',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );

				await probe.reset();
				const startedAt = Date.now();

				await page.evaluate( () => {
					window.dispatchEvent(
						new Event( 'cortext:open-command-palette' )
					);
				} );
				await waitForCommandPaletteReady( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'palette_search_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		await admin.visitAdminPage( 'admin.php', collection.adminQuery );
		await waitForCollectionReady( page );

		await page.evaluate( () => {
			window.dispatchEvent( new Event( 'cortext:open-command-palette' ) );
		} );
		await waitForCommandPaletteReady( page );

		const input = page.getByPlaceholder(
			'Search pages, collections, and actions'
		);

		await probe.reset();
		const responsePromise = page.waitForResponse(
			( response ) =>
				response.url().includes( '/cortext/v1/documents' ) &&
				response.url().includes( 'search=' ),
			{ timeout: READY_TIMEOUT_MS }
		);
		const startedAt = Date.now();

		// "Perf" matches every seeded row in `perfmain`; the palette only shows
		// 10 results, so the first visible option is enough.
		await input.fill( 'Perf' );
		await responsePromise;
		await page
			.getByRole( 'option' )
			.first()
			.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
		await waitForPaint( page );

		scenarios.palette_search_ready = tag(
			'surface',
			await probe.snapshot( startedAt )
		);
	} );

	test( 'workspace_home_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.workspace_home_ready = tag(
			'navigation',
			await runRepeated( probe, async () => {
				const responsePromise = page.waitForResponse(
					( response ) =>
						response.url().includes( '/cortext/v1/workspace-home' ),
					{ timeout: READY_TIMEOUT_MS }
				);
				const startedAt = Date.now();

				await admin.visitAdminPage( 'admin.php', 'page=cortext' );
				await responsePromise;
				await page.locator( '.cortext-sidebar' ).first().waitFor( {
					state: 'visible',
					timeout: READY_TIMEOUT_MS,
				} );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'shell_navigation_warm', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.shell_navigation_warm = tag(
			'navigation',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );

				const previousFirstRow = await readFirstRowText( page );

				await probe.reset();
				const responsePromise = page.waitForResponse(
					( response ) =>
						response.url().includes( ROWS_API_SEGMENT ) &&
						! response
							.url()
							.includes( `collection=${ collection.id }` ),
					{ timeout: READY_TIMEOUT_MS }
				);
				const startedAt = Date.now();

				await page
					.locator( '.cortext-sidebar' )
					.getByRole( 'button', {
						name: 'Perf Target 1',
						exact: true,
					} )
					.click();
				await responsePromise;
				await waitForFirstRowChanged( page, previousFirstRow );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'search_rows_ready', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.search_rows_ready = tag(
			'collection_read',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
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

				// Use the last seeded row's suffix. That narrows the table to
				// one row, so the first row actually changes; 'Perf' matches
				// every seeded row.
				await activeCollectionView( page )
					.locator( '.dataviews-search input' )
					.fill( '01250' );
				await responsePromise;
				await waitForFirstRowChanged( page, previousFirstRow );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
		);
	} );

	test( 'row_navigate_next', async ( { admin, page } ) => {
		const probe = await setupProbe( page );

		scenarios.row_navigate_next = tag(
			'row',
			await runRepeated( probe, async () => {
				await admin.visitAdminPage(
					'admin.php',
					collection.adminQuery
				);
				await waitForCollectionReady( page );
				await clearCollectionSearch( page );
				await activeCollectionView( page )
					.getByLabel( 'Open row' )
					.first()
					.click( { force: true } );
				await waitForRowDetailReady( page );

				// Seeded perf rows can expose an empty editor title while still
				// navigating correctly. The remounted title block is the stable
				// signal that the row-detail iframe has switched rows.
				const titleLocator = rowDetailCanvas( page )
					.locator( '[data-type="core/post-title"]' )
					.first();
				const previousTitleBlock =
					await titleLocator.getAttribute( 'data-block' );

				await probe.reset();
				const responsePromise = page.waitForResponse(
					( response ) =>
						response
							.url()
							.includes( `/wp/v2/crtxt_${ COLLECTION_SLUG }/` ),
					{ timeout: READY_TIMEOUT_MS }
				);
				const startedAt = Date.now();

				await page.getByLabel( 'Row below' ).click();
				await responsePromise;
				await expect
					.poll( () => titleLocator.getAttribute( 'data-block' ), {
						timeout: READY_TIMEOUT_MS,
					} )
					.not.toBe( previousTitleBlock );
				await waitForPaint( page );

				return probe.snapshot( startedAt );
			} )
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
		await Promise.all(
			page.frames().map( async ( frame ) => {
				try {
					await frame.evaluate( () => {
						window.__cortextPerfLongTasks = [];
					} );
				} catch {
					// Frames can detach while navigating between iterations.
				}
			} )
		);
	};

	const readLongTasks = async () => {
		const taskLists = await Promise.all(
			page.frames().map( async ( frame ) => {
				try {
					return await frame.evaluate(
						() => window.__cortextPerfLongTasks ?? []
					);
				} catch {
					return [];
				}
			} )
		);

		return taskLists
			.flat()
			.filter(
				( duration ) =>
					typeof duration === 'number' && Number.isFinite( duration )
			);
	};

	return {
		async reset() {
			requests.length = 0;
			await resetLongTasks();
		},
		async snapshot( startedAt ) {
			const readyMs = Date.now() - startedAt;
			// Median across captured /cortext/v1/rows responses in this
			// window. The old "first matching" value was a single-event
			// timing, so scenarios with several rows requests (pagination,
			// shell nav) reported whichever fired first instead of the
			// typical request.
			const rowsDurations = requests
				.filter(
					( entry ) =>
						entry.url.includes( ROWS_API_SEGMENT ) &&
						typeof entry.duration === 'number'
				)
				.map( ( entry ) => entry.duration );
			const longTasks = await readLongTasks();

			return {
				ready_ms: readyMs,
				rows_api_ms:
					rowsDurations.length > 0
						? percentile( rowsDurations, 50 )
						: null,
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

function activeCollectionCanvas( page ) {
	return page.frameLocator( ACTIVE_WORKSPACE_CANVAS_FRAME_SELECTOR );
}

function rowDetailCanvas( page ) {
	return page.frameLocator( ROW_DETAIL_CANVAS_FRAME_SELECTOR );
}

function activeCollectionView( page ) {
	return activeCollectionCanvas( page )
		.locator( ACTIVE_COLLECTION_VIEW_SELECTOR )
		.first();
}

function activeCollectionRows( page ) {
	return activeCollectionView( page ).locator( DATA_VIEW_ROW_SELECTOR );
}

async function waitForCollectionReady( page ) {
	const dataView = activeCollectionView( page );

	await dataView
		.locator( '.dataviews-wrapper' )
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	await activeCollectionRows( page )
		.first()
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	await waitForPaint( page );
}

async function readFirstRowText( page ) {
	return activeCollectionRows( page ).first().textContent();
}

async function waitForFirstRowChanged( page, previousText ) {
	await expect
		.poll(
			async () => {
				const row = activeCollectionRows( page ).first();
				return ( await row.count() ) > 0
					? row.textContent()
					: previousText;
			},
			{ timeout: READY_TIMEOUT_MS }
		)
		.not.toBe( previousText );
}

async function clearCollectionSearch( page ) {
	const searchInput = activeCollectionView( page ).locator(
		'.dataviews-search input'
	);
	const value = await searchInput.inputValue();
	if ( value === '' ) {
		return;
	}

	const responsePromise = page.waitForResponse(
		( response ) => response.url().includes( ROWS_API_SEGMENT ),
		{ timeout: READY_TIMEOUT_MS }
	);
	await searchInput.fill( '' );
	await responsePromise;
	await waitForCollectionReady( page );
}

async function waitForRowDetailReady( page ) {
	await page
		.locator( '.cortext-row-detail__frame' )
		.first()
		.waitFor( { state: 'visible', timeout: READY_TIMEOUT_MS } );
	// Row detail is not ready until its own iframe has rendered the title block.
	await rowDetailCanvas( page )
		.locator( '[data-type="core/post-title"]' )
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
	await Promise.all(
		page.frames().map( async ( frame ) => {
			try {
				await frame.evaluate(
					() =>
						new Promise( ( resolve ) => {
							window.requestAnimationFrame( () =>
								window.requestAnimationFrame( resolve )
							);
						} )
				);
			} catch {
				// A frame can detach during route changes; other frames still paint.
			}
		} )
	);
}
