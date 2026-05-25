/**
 * E2E coverage for route transitions that should not tear down the canvas.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const FIRST_PAGE_TITLE = `E2E Lifecycle Page A ${ SUFFIX }`;
const SECOND_PAGE_TITLE = `E2E Lifecycle Page B ${ SUFFIX }`;
const COLLECTION_TITLE = `E2E Lifecycle Collection ${ SUFFIX }`;
const ENTRY_TITLE = `E2E Lifecycle Entry ${ SUFFIX }`;
const HISTORY_FIRST_PAGE_TITLE = `E2E History Page A ${ SUFFIX }`;
const HISTORY_SECOND_PAGE_TITLE = `E2E History Page B ${ SUFFIX }`;
const HISTORY_COLLECTION_TITLE = `E2E History Collection ${ SUFFIX }`;
const NO_FLASH_FIRST_PAGE_TITLE = `E2E No Flash Page A ${ SUFFIX }`;
const NO_FLASH_SECOND_PAGE_TITLE = `E2E No Flash Page B ${ SUFFIX }`;
const COVER_FIRST_PAGE_TITLE = `E2E Cover Page A ${ SUFFIX }`;
const COVER_SECOND_PAGE_TITLE = `E2E Cover Page B ${ SUFFIX }`;
const COVER_PNG = Buffer.from(
	'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAGklEQVR42mP8z8BQz0AEYBxVSFUBAAAcZgP9vyv3NwAAAABJRU5ErkJggg==',
	'base64'
);

test.use( {
	contextOptions: {
		reducedMotion: 'no-preference',
		strictSelectors: true,
	},
} );

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
		// Best-effort cleanup; the record may already be gone.
	}
}

async function uploadCoverMedia( requestUtils, name ) {
	return requestUtils.uploadMedia( {
		name,
		mimeType: 'image/png',
		buffer: COVER_PNG,
	} );
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

async function coverImagePainted( page ) {
	const frame = page.frame( { name: 'editor-canvas' } );
	if ( ! frame ) {
		return false;
	}
	const image = frame.locator( '.cortext-document-cover-block__image' );
	if ( ( await image.count() ) === 0 ) {
		return false;
	}
	return image.evaluate( ( node ) => {
		const style = node.ownerDocument.defaultView.getComputedStyle( node );
		return (
			node.complete &&
			node.naturalWidth > 0 &&
			Number( style.opacity ) === 1
		);
	} );
}

async function waitForCoverImagePainted( page ) {
	await expect
		.poll( () => coverImagePainted( page ), {
			message:
				'the cover image should paint before the canvas is marked ready',
		} )
		.toBe( true );
}

async function canvasContainsAnyTitle( page, titles ) {
	const frame = page.frame( { name: 'editor-canvas' } );
	if ( ! frame ) {
		return false;
	}
	return frame.locator( 'body' ).evaluate( ( body, expectedTitles ) => {
		const text = body.innerText || '';
		return expectedTitles.some( ( title ) => text.includes( title ) );
	}, titles );
}

async function oldCanvasSnapshotState( page ) {
	return page.evaluate( () => {
		const mode =
			document.documentElement.dataset.cortextViewTransition || '';
		const oldCanvas = window.getComputedStyle(
			document.documentElement,
			'::view-transition-old(cortext-canvas)'
		);
		const animationName = oldCanvas.animationName;
		const opacity = Number( oldCanvas.opacity );
		const isHolding =
			mode === 'hold-old-canvas' &&
			animationName.includes( 'cortext-hold-old-canvas' ) &&
			opacity === 1;
		return { animationName, isHolding, mode, opacity };
	} );
}

async function isHoldingOldCanvasSnapshot( page ) {
	const state = await oldCanvasSnapshotState( page );
	return state.isHolding;
}

async function expectOldCanvasSnapshotHeld( page ) {
	const state = await oldCanvasSnapshotState( page );
	expect( state ).toEqual(
		expect.objectContaining( {
			animationName: expect.stringContaining( 'cortext-hold-old-canvas' ),
			isHolding: true,
			mode: 'hold-old-canvas',
			opacity: 1,
		} )
	);
}

async function waitForCanvasTitleWithoutBlanking( page, titles, targetTitle ) {
	const deadline = Date.now() + 5000;
	while ( Date.now() < deadline ) {
		const [ hasAnyTitle, hasTargetTitle, isHoldingSnapshot ] =
			await Promise.all( [
				canvasContainsAnyTitle( page, titles ),
				canvasContainsAnyTitle( page, [ targetTitle ] ),
				isHoldingOldCanvasSnapshot( page ),
			] );

		if ( ! hasAnyTitle && ! isHoldingSnapshot ) {
			throw new Error(
				'The canvas went blank while the old snapshot was not covering it.'
			);
		}
		if ( hasTargetTitle ) {
			return;
		}
		await page.waitForTimeout( 16 );
	}

	throw new Error(
		`Timed out before ${ targetTitle } appeared in the canvas.`
	);
}

async function waitForTransitionModeToClear( page ) {
	await page.waitForFunction(
		() => ! document.documentElement.dataset.cortextViewTransition
	);
}

async function resetViewTransitionProbe( page ) {
	return page.evaluate( () => {
		if (
			typeof document.startViewTransition !== 'function' ||
			window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
		) {
			return false;
		}
		if ( ! window.__cortextViewTransitionOriginal ) {
			window.__cortextViewTransitionOriginal =
				document.startViewTransition.bind( document );
			window.__cortextViewTransitionNextId = 0;
			document.startViewTransition = ( callback ) => {
				const id = ++window.__cortextViewTransitionNextId;
				const record = ( type, extra = {} ) => {
					window.__cortextViewTransitionEvents.push( {
						id,
						type,
						mode:
							document.documentElement.dataset
								.cortextViewTransition || '',
						...extra,
					} );
				};
				record( 'start' );
				const transition = window.__cortextViewTransitionOriginal(
					() => {
						record( 'callback-start' );
						let result;
						try {
							result = callback();
						} catch ( error ) {
							record( 'callback-threw', {
								name: error?.name || '',
								message: error?.message || '',
							} );
							throw error;
						}
						Promise.resolve( result ).then(
							() => record( 'callback-done' ),
							( error ) =>
								record( 'callback-rejected', {
									name: error?.name || '',
									message: error?.message || '',
								} )
						);
						return result;
					}
				);
				transition.ready.then(
					() => record( 'ready' ),
					( error ) =>
						record( 'ready-rejected', {
							name: error?.name || '',
							message: error?.message || '',
						} )
				);
				transition.finished.then(
					() => record( 'finished' ),
					( error ) =>
						record( 'finished-rejected', {
							name: error?.name || '',
							message: error?.message || '',
						} )
				);
				return transition;
			};
		}
		window.__cortextViewTransitionEvents = [];
		return true;
	} );
}

async function expectRouteViewTransition( page, label, expectedMode = '' ) {
	const supportsViewTransitions = await page.evaluate( () =>
		Boolean( window.__cortextViewTransitionOriginal )
	);
	if ( ! supportsViewTransitions ) {
		return;
	}

	await expect
		.poll(
			() =>
				page.evaluate( () =>
					( window.__cortextViewTransitionEvents || [] ).some(
						( event ) => event.type === 'start'
					)
				),
			{ message: `${ label } should trigger a route transition` }
		)
		.toBe( true );

	const rejectedEvents = await page.evaluate( () =>
		( window.__cortextViewTransitionEvents || [] ).filter( ( event ) =>
			[
				'callback-threw',
				'callback-rejected',
				'ready-rejected',
				'finished-rejected',
			].includes( event.type )
		)
	);
	expect( rejectedEvents ).toEqual( [] );
	const hasReadyRouteTransition = await page.evaluate(
		( mode ) =>
			( window.__cortextViewTransitionEvents || [] ).some(
				( event ) => event.type === 'ready' && event.mode === mode
			),
		expectedMode
	);
	expect( hasReadyRouteTransition ).toBe( true );
}

async function activeDataViewPaintState( page, texts ) {
	return page.evaluate( ( expectedTexts ) => {
		const pane = document.querySelector(
			'.cortext-workspace__pane[data-active="true"]'
		);
		if ( ! pane ) {
			return {
				hasDataView: false,
				hasLoadingShell: false,
				hasSkeleton: false,
				hasText: false,
			};
		}
		// Full-page collections render inside the BlockCanvas iframe. Look
		// inside the iframe document first; fall back to the pane DOM so any
		// future surface that mounts the table directly still works here.
		const iframe = pane.querySelector( 'iframe[name="editor-canvas"]' );
		const dataView =
			iframe?.contentDocument?.querySelector( '.cortext-data-view' ) ??
			pane.querySelector( '.cortext-data-view' );
		if ( ! dataView ) {
			return {
				hasDataView: false,
				hasLoadingShell: false,
				hasSkeleton: false,
				hasText: false,
			};
		}
		const text = dataView.innerText || '';
		return {
			hasDataView: true,
			hasLoadingShell:
				dataView.getAttribute( 'data-loading-shell' ) === 'true',
			hasSkeleton: Boolean(
				dataView.querySelector( '.cortext-data-view__rows-skeleton' )
			),
			hasText: expectedTexts.some( ( expected ) =>
				text.includes( expected )
			),
		};
	}, texts );
}

async function waitForActiveDataViewWithoutBlanking( page, texts ) {
	const deadline = Date.now() + 5000;
	while ( Date.now() < deadline ) {
		const state = await activeDataViewPaintState( page, texts );
		if ( state.hasDataView && ! state.hasSkeleton && ! state.hasText ) {
			throw new Error(
				'Full-page DataViews showed an empty shell instead of loading or loaded content.'
			);
		}
		if ( state.hasText ) {
			return;
		}
		await page.waitForTimeout( 16 );
	}

	throw new Error( 'Timed out before full-page DataViews content appeared.' );
}

test.describe( 'Navigation lifecycle', () => {
	test( 'top bar back and forward stay in sync with browser history', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};

		try {
			fixture.firstPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: HISTORY_FIRST_PAGE_TITLE, status: 'private' },
			} );
			fixture.secondPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: HISTORY_SECOND_PAGE_TITLE, status: 'private' },
			} );
			fixture.slug = `e2ehist${ SUFFIX }`;
			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: HISTORY_COLLECTION_TITLE,
					status: 'private',
					meta: { slug: fixture.slug },
				},
			} );

			const backButton = page.getByRole( 'button', {
				name: 'Go back',
			} );
			const forwardButton = page.getByRole( 'button', {
				name: 'Go forward',
			} );
			const sidebar = page.locator( '.cortext-sidebar' );
			const breadcrumb = page.getByRole( 'navigation', {
				name: 'Breadcrumb',
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.firstPage.id }`
			);
			await waitForEditorPost( page, fixture.firstPage.id );
			await expect( backButton ).toBeDisabled();
			await expect( forwardButton ).toBeDisabled();

			await sidebar
				.getByRole( 'button', {
					name: HISTORY_SECOND_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, fixture.secondPage.id );
			await expect( backButton ).toBeEnabled();
			await expect( forwardButton ).toBeDisabled();

			await backButton.click();
			await waitForEditorPost( page, fixture.firstPage.id );
			await expect( backButton ).toBeDisabled();
			await expect( forwardButton ).toBeEnabled();

			await forwardButton.click();
			await waitForEditorPost( page, fixture.secondPage.id );
			await expect( backButton ).toBeEnabled();
			await expect( forwardButton ).toBeDisabled();

			await sidebar
				.getByRole( 'button', {
					name: HISTORY_COLLECTION_TITLE,
					exact: true,
				} )
				.click();
			await expect( breadcrumb ).toContainText(
				HISTORY_COLLECTION_TITLE
			);
			await expect( backButton ).toBeEnabled();
			await expect( forwardButton ).toBeDisabled();

			await page.goBack();
			await waitForEditorPost( page, fixture.secondPage.id );
			await expect( forwardButton ).toBeEnabled();

			await page.goForward();
			await expect( breadcrumb ).toContainText(
				HISTORY_COLLECTION_TITLE
			);
			await expect( forwardButton ).toBeDisabled();
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.secondPage &&
					`/wp/v2/crtxt_pages/${ fixture.secondPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.firstPage &&
					`/wp/v2/crtxt_pages/${ fixture.firstPage.id }`
			);
		}
	} );

	test( 'keeps page content visible while moving between pages', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		let releaseLocator = () => {};

		try {
			fixture.firstPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: NO_FLASH_FIRST_PAGE_TITLE,
					status: 'private',
				},
			} );
			fixture.secondPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: NO_FLASH_SECOND_PAGE_TITLE,
					status: 'private',
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.firstPage.id }`
			);
			await waitForEditorPost( page, fixture.firstPage.id );

			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			await expect(
				canvas.getByText( NO_FLASH_FIRST_PAGE_TITLE, { exact: true } )
			).toBeVisible();

			const locatorGate = new Promise( ( resolve ) => {
				releaseLocator = resolve;
			} );
			await page.route(
				`**/wp-json/cortext/v1/documents/${ fixture.secondPage.id }`,
				async ( route ) => {
					await locatorGate;
					await route.continue();
				}
			);
			const locatorRequest = page.waitForRequest( ( request ) =>
				request
					.url()
					.includes(
						`/wp-json/cortext/v1/documents/${ fixture.secondPage.id }`
					)
			);

			await page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', {
					name: NO_FLASH_SECOND_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await locatorRequest;
			await page.waitForTimeout( 100 );
			expect(
				await canvasContainsAnyTitle( page, [
					NO_FLASH_FIRST_PAGE_TITLE,
					NO_FLASH_SECOND_PAGE_TITLE,
				] )
			).toBe( true );

			releaseLocator();
			await waitForCanvasTitleWithoutBlanking(
				page,
				[ NO_FLASH_FIRST_PAGE_TITLE, NO_FLASH_SECOND_PAGE_TITLE ],
				NO_FLASH_SECOND_PAGE_TITLE
			);

			await waitForEditorPost( page, fixture.secondPage.id );
			await expect(
				canvas.getByText( NO_FLASH_SECOND_PAGE_TITLE, {
					exact: true,
				} )
			).toBeVisible();
		} finally {
			releaseLocator();
			await deleteIfCreated(
				requestUtils,
				fixture.secondPage &&
					`/wp/v2/crtxt_pages/${ fixture.secondPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.firstPage &&
					`/wp/v2/crtxt_pages/${ fixture.firstPage.id }`
			);
		}
	} );

	test( 'waits for cover images before revealing the next page', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		let releaseCoverImage = () => {};
		let markCoverImageRequested = () => {};

		try {
			fixture.firstMedia = await uploadCoverMedia(
				requestUtils,
				`cover-a-${ SUFFIX }.png`
			);
			fixture.secondMedia = await uploadCoverMedia(
				requestUtils,
				`cover-b-${ SUFFIX }.png`
			);
			fixture.firstPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: COVER_FIRST_PAGE_TITLE,
					status: 'private',
					featured_media: fixture.firstMedia.id,
				},
			} );
			fixture.secondPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: COVER_SECOND_PAGE_TITLE,
					status: 'private',
					featured_media: fixture.secondMedia.id,
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.firstPage.id }`
			);
			await waitForEditorPost( page, fixture.firstPage.id );
			await waitForCoverImagePainted( page );

			const coverImageGate = new Promise( ( resolve ) => {
				releaseCoverImage = resolve;
			} );
			const coverImageRequested = new Promise( ( resolve ) => {
				markCoverImageRequested = resolve;
			} );
			const coverImageName = `cover-b-${ SUFFIX }.png`;
			await page.route( `**/${ coverImageName }**`, async ( route ) => {
				markCoverImageRequested();
				await coverImageGate;
				await route.continue();
			} );

			await page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', {
					name: COVER_SECOND_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await coverImageRequested;
			await page.waitForTimeout( 100 );
			if ( ! ( await coverImagePainted( page ) ) ) {
				await expectOldCanvasSnapshotHeld( page );
			}

			releaseCoverImage();
			await waitForTransitionModeToClear( page );
			await waitForEditorPost( page, fixture.secondPage.id );
			await waitForCoverImagePainted( page );
		} finally {
			releaseCoverImage();
			await deleteIfCreated(
				requestUtils,
				fixture.secondPage &&
					`/wp/v2/crtxt_pages/${ fixture.secondPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.firstPage &&
					`/wp/v2/crtxt_pages/${ fixture.firstPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.secondMedia &&
					`/wp/v2/media/${ fixture.secondMedia.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.firstMedia && `/wp/v2/media/${ fixture.firstMedia.id }`
			);
		}
	} );

	test( 'keeps the current page visible while collection rows load', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const fixture = {};
		let releaseCollection = () => {};
		let releaseRows = () => {};

		try {
			fixture.firstPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: FIRST_PAGE_TITLE, status: 'private' },
			} );
			fixture.secondPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: { title: SECOND_PAGE_TITLE, status: 'private' },
			} );
			fixture.slug = `e2elife${ SUFFIX }`;
			fixture.collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_collections',
				data: {
					title: COLLECTION_TITLE,
					status: 'private',
					meta: { slug: fixture.slug },
				},
			} );
			fixture.entry = await requestUtils.rest( {
				method: 'POST',
				path: `/wp/v2/crtxt_${ fixture.slug }`,
				data: { title: ENTRY_TITLE, status: 'private' },
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.firstPage.id }`
			);
			await waitForEditorPost( page, fixture.firstPage.id );

			const canvasBefore = await page
				.locator( '.cortext-canvas' )
				.elementHandle();
			expect( canvasBefore ).not.toBeNull();

			const sidebar = page.locator( '.cortext-sidebar' );
			await sidebar
				.getByRole( 'button', {
					name: SECOND_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, fixture.secondPage.id );
			await waitForTransitionModeToClear( page );

			const canvasAfter = await page
				.locator( '.cortext-canvas' )
				.elementHandle();
			expect( canvasAfter ).not.toBeNull();
			await expect( page.locator( '.cortext-canvas' ) ).toHaveCount( 1 );
			const keptCanvas = await page.evaluate(
				( [ before, after ] ) => before === after,
				[ canvasBefore, canvasAfter ]
			);
			expect( keptCanvas ).toBe( true );

			const pagePane = page
				.locator( '.cortext-workspace__pane' )
				.filter( { has: page.locator( '.cortext-canvas' ) } );
			await expect( pagePane ).toHaveAttribute( 'data-active', 'true' );

			const collectionGate = new Promise( ( resolve ) => {
				releaseCollection = resolve;
			} );
			await page.route(
				`**/wp-json/wp/v2/crtxt_collections/${ fixture.collection.id }**`,
				async ( route ) => {
					await collectionGate;
					await route.continue();
				}
			);
			const collectionRequest = page.waitForRequest( ( request ) =>
				request
					.url()
					.includes(
						`/wp-json/wp/v2/crtxt_collections/${ fixture.collection.id }`
					)
			);
			const rowsGate = new Promise( ( resolve ) => {
				releaseRows = resolve;
			} );
			await page.route(
				'**/wp-json/cortext/v1/rows**',
				async ( route ) => {
					if (
						route
							.request()
							.url()
							.includes( `collection=${ fixture.collection.id }` )
					) {
						await rowsGate;
					}
					await route.continue();
				}
			);
			const rowsRequest = page.waitForRequest(
				( request ) =>
					request.url().includes( '/wp-json/cortext/v1/rows' ) &&
					request
						.url()
						.includes( `collection=${ fixture.collection.id }` )
			);

			await resetViewTransitionProbe( page );
			await sidebar
				.getByRole( 'button', {
					name: COLLECTION_TITLE,
					exact: true,
				} )
				.click();
			await collectionRequest;
			await expect( pagePane ).toHaveAttribute( 'data-active', 'true' );
			releaseCollection();
			await rowsRequest;
			await expect( pagePane ).toHaveAttribute( 'data-active', 'true' );

			// Full-page collections now render inside the BlockCanvas iframe,
			// so the data-view is never directly under the workspace pane.
			await expect(
				page.locator(
					'.cortext-workspace__pane[data-active="true"] > .cortext-data-view'
				)
			).toHaveCount( 0 );

			const dataViewPaint = waitForActiveDataViewWithoutBlanking( page, [
				ENTRY_TITLE,
			] );
			releaseRows();
			await expectRouteViewTransition(
				page,
				'document to collection',
				'hold-old-canvas'
			);
			await dataViewPaint;

			const activeCollection = page
				.frameLocator( '[name="editor-canvas"]' )
				.locator( '.cortext-data-view' );
			await expect( activeCollection ).toBeVisible();
			await expect( activeCollection ).toContainText( ENTRY_TITLE );

			// Pages and collections share the Canvas pane now, so the pane
			// stays active through the swap; the document inside the iframe
			// is what changes.
			await expect( pagePane ).toHaveAttribute( 'data-active', 'true' );
			await expect( pagePane ).toHaveCSS( 'visibility', 'visible' );

			await resetViewTransitionProbe( page );
			await sidebar
				.getByRole( 'button', {
					name: FIRST_PAGE_TITLE,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, fixture.firstPage.id );
			await expectRouteViewTransition(
				page,
				'collection to document',
				'hold-old-canvas'
			);
			await expect( pagePane ).toHaveAttribute( 'data-active', 'true' );
			const canvasAfterCollection = await page
				.locator( '.cortext-canvas' )
				.elementHandle();
			const keptCanvasAfterCollection = await page.evaluate(
				( [ before, after ] ) => before === after,
				[ canvasAfter, canvasAfterCollection ]
			);
			expect( keptCanvasAfterCollection ).toBe( true );
		} finally {
			releaseCollection();
			releaseRows();
			await deleteIfCreated(
				requestUtils,
				fixture.entry &&
					`/wp/v2/crtxt_${ fixture.slug }/${ fixture.entry.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.collection &&
					`/wp/v2/crtxt_collections/${ fixture.collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.secondPage &&
					`/wp/v2/crtxt_pages/${ fixture.secondPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture.firstPage &&
					`/wp/v2/crtxt_pages/${ fixture.firstPage.id }`
			);
		}
	} );
} );
