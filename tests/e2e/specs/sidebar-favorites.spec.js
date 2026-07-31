/**
 * E2E coverage for per-user sidebar favorites.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const PAGE_TITLE = `E2E Favorite Page ${ SUFFIX }`;
const COLLECTION_TITLE = `E2E Favorite Collection ${ SUFFIX }`;

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

async function storedFavoriteKeys( requestUtils ) {
	const response = await requestUtils.rest( {
		path: '/cortext/v1/favorites',
	} );
	return ( response?.favorites ?? [] ).map(
		( favorite ) => `favorite:${ favorite.id }`
	);
}

async function expectStoredFavorites( requestUtils, keys ) {
	await expect
		.poll( () => storedFavoriteKeys( requestUtils ) )
		.toEqual( keys );
}

async function favoriteFromSidebar( page, title, requestUtils, storedKeys ) {
	const sidebar = page.locator( '.cortext-sidebar' );
	await sidebar.getByRole( 'button', { name: title, exact: true } ).hover();
	await sidebar
		.getByRole( 'button', {
			name: `Actions for ${ title }`,
			exact: true,
		} )
		.click( { force: true } );
	await page.getByRole( 'menuitem', { name: 'Add to favorites' } ).click();
	await expect(
		page.locator( '.cortext-sidebar__favorites' ).getByText( title )
	).toBeVisible();
	await expectStoredFavorites( requestUtils, storedKeys );
}

async function removeFavorite( page, title, requestUtils, storedKeys ) {
	const favorites = page.locator( '.cortext-sidebar__favorites' );
	await favorites
		.getByRole( 'button', {
			name: `Remove ${ title } from favorites`,
			exact: true,
		} )
		.click( { force: true } );
	await expectStoredFavorites( requestUtils, storedKeys );
}

async function favoriteTitles( page ) {
	return page
		.locator(
			'.cortext-sidebar__favorites .cortext-sidebar__favorite-title'
		)
		.evaluateAll( ( buttons ) =>
			buttons.map( ( button ) => button.textContent.trim() )
		);
}

async function dragFavoriteBefore(
	page,
	activeKey,
	overKey,
	requestUtils,
	storedKeys
) {
	const active = page.locator(
		`.cortext-sidebar__favorite-row[data-favorite-key="${ activeKey }"] .cortext-sidebar__row`
	);
	const over = page.locator(
		`.cortext-sidebar__favorite-row[data-favorite-key="${ overKey }"] .cortext-sidebar__row`
	);
	await active.scrollIntoViewIfNeeded();
	await over.scrollIntoViewIfNeeded();
	const activeBox = await active.boundingBox();
	const overBox = await over.boundingBox();
	expect( activeBox ).toBeTruthy();
	expect( overBox ).toBeTruthy();

	await page.mouse.move(
		activeBox.x + 12,
		activeBox.y + activeBox.height / 2
	);
	await page.mouse.down();
	await page.mouse.move( overBox.x + 12, overBox.y + overBox.height / 2, {
		steps: 8,
	} );
	await page.mouse.up();
	await expectStoredFavorites( requestUtils, storedKeys );
}

async function rowBackground( locator ) {
	return locator.evaluate(
		( element ) => window.getComputedStyle( element ).backgroundColor
	);
}

async function rowBackgroundFrames( locator, frameCount = 24 ) {
	return locator.evaluate(
		( element, count ) =>
			new Promise( ( resolve ) => {
				const frames = [];
				const sample = () => {
					frames.push(
						window.getComputedStyle( element ).backgroundColor
					);
					if ( frames.length >= count ) {
						resolve( frames );
						return;
					}
					window.requestAnimationFrame( sample );
				};
				window.requestAnimationFrame( sample );
			} ),
		frameCount
	);
}

async function activeElementClass( page ) {
	return page
		.locator( 'body' )
		.evaluate(
			( body ) =>
				body.ownerDocument.activeElement?.className?.toString() ?? ''
		);
}

test.describe( 'Sidebar favorites', () => {
	test( 'star, unstar, reorder, and persist favorites', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let createdPage;
		let collection;

		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: PAGE_TITLE,
					status: 'private',
				},
			} );
			collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: COLLECTION_TITLE,
					status: 'private',
				},
			} );
			await requestUtils.rest( {
				method: 'PUT',
				path: '/cortext/v1/favorites',
				data: { favorites: [] },
			} );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );
			const pageKey = `favorite:${ createdPage.id }`;
			const collectionKey = `favorite:${ collection.id }`;

			await favoriteFromSidebar( page, PAGE_TITLE, requestUtils, [
				pageKey,
			] );
			await favoriteFromSidebar( page, COLLECTION_TITLE, requestUtils, [
				pageKey,
				collectionKey,
			] );

			const favorites = page.locator(
				'.cortext-sidebar__section--favorites'
			);
			await expect(
				favorites.getByRole( 'heading', { name: 'Favorites' } )
			).toBeVisible();
			await expect( favorites.getByText( PAGE_TITLE ) ).toBeVisible();
			await expect(
				favorites.getByText( COLLECTION_TITLE )
			).toBeVisible();

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );
			await expect(
				page.locator( '.cortext-sidebar__favorites' )
			).toBeVisible();
			await expect
				.poll( () => favoriteTitles( page ) )
				.toEqual( [ PAGE_TITLE, COLLECTION_TITLE ] );

			await removeFavorite( page, PAGE_TITLE, requestUtils, [
				collectionKey,
			] );
			await expect
				.poll( () => favoriteTitles( page ) )
				.toEqual( [ COLLECTION_TITLE ] );

			await favoriteFromSidebar( page, PAGE_TITLE, requestUtils, [
				collectionKey,
				pageKey,
			] );
			await dragFavoriteBefore(
				page,
				pageKey,
				collectionKey,
				requestUtils,
				[ pageKey, collectionKey ]
			);
			await expect
				.poll( () => favoriteTitles( page ) )
				.toEqual( [ PAGE_TITLE, COLLECTION_TITLE ] );

			await admin.visitAdminPage( 'admin.php', 'page=cortext' );
			await expect
				.poll( () => favoriteTitles( page ) )
				.toEqual( [ PAGE_TITLE, COLLECTION_TITLE ] );
		} finally {
			await deleteIfCreated(
				requestUtils,
				collection && `/wp/v2/crtxt_documents/${ collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_documents/${ createdPage.id }`
			);
		}
	} );

	test( 'favorite title click keeps the hover background stable', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let createdPage;
		let otherPage;

		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `${ PAGE_TITLE } Flash`,
					status: 'private',
				},
			} );
			otherPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: `${ PAGE_TITLE } Flash Target`,
					status: 'private',
				},
			} );
			await requestUtils.rest( {
				method: 'PUT',
				path: '/cortext/v1/favorites',
				data: {
					favorites: [ { id: createdPage.id }, { id: otherPage.id } ],
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ createdPage.id }`
			);

			const row = page.locator(
				`.cortext-sidebar__favorite-row[data-favorite-key="favorite:${ createdPage.id }"] .cortext-sidebar__row`
			);
			const title = row.locator( '.cortext-sidebar__favorite-title' );
			await expect( row ).toBeVisible();
			await title.hover();

			const hoveredBackground = await rowBackground( row );
			const box = await title.boundingBox();
			expect( box ).toBeTruthy();

			await page.mouse.move(
				box.x + box.width / 2,
				box.y + box.height / 2
			);
			await page.mouse.down();
			const downBackground = await rowBackground( row );
			await page.mouse.up();
			const upBackground = await rowBackground( row );
			const activeClass = await activeElementClass( page );
			const postClickBackgrounds = await rowBackgroundFrames( row );

			expect( downBackground ).toBe( hoveredBackground );
			expect( upBackground ).toBe( hoveredBackground );
			expect( activeClass ).not.toContain(
				'cortext-sidebar__favorite-title'
			);
			expect( postClickBackgrounds ).toEqual(
				Array( postClickBackgrounds.length ).fill( hoveredBackground )
			);

			const otherRow = page.locator(
				`.cortext-sidebar__favorite-row[data-favorite-key="favorite:${ otherPage.id }"] .cortext-sidebar__row`
			);
			const otherTitle = otherRow.locator(
				'.cortext-sidebar__favorite-title'
			);
			await otherTitle.hover();
			const otherHoveredBackground = await rowBackground( otherRow );
			const otherBox = await otherTitle.boundingBox();
			expect( otherBox ).toBeTruthy();

			await page.mouse.move(
				otherBox.x + otherBox.width / 2,
				otherBox.y + otherBox.height / 2
			);
			await page.mouse.down();
			const otherDownBackground = await rowBackground( otherRow );
			await page.mouse.up();
			const otherUpBackground = await rowBackground( otherRow );
			const otherPostClickBackgrounds =
				await rowBackgroundFrames( otherRow );

			expect( otherDownBackground ).toBe( otherHoveredBackground );
			expect( otherUpBackground ).toBe( otherHoveredBackground );
			expect( otherPostClickBackgrounds ).toEqual(
				Array( otherPostClickBackgrounds.length ).fill(
					otherHoveredBackground
				)
			);
			await expect
				.poll( () => activeElementClass( page ) )
				.not.toContain( 'cortext-sidebar__favorite-title' );
		} finally {
			await deleteIfCreated(
				requestUtils,
				otherPage && `/wp/v2/crtxt_documents/${ otherPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_documents/${ createdPage.id }`
			);
		}
	} );
} );
