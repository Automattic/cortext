/**
 * E2E coverage for the locked document header block prefix.
 */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const DOCUMENT_ICON_BLOCK = 'cortext/document-icon';
const DOCUMENT_COVER_BLOCK = 'cortext/document-cover';
const DOCUMENT_PROPERTIES_BLOCK = 'cortext/document-properties';
const POST_TITLE_BLOCK = 'core/post-title';
const HEADER_BLOCK_NAMES = [
	DOCUMENT_COVER_BLOCK,
	DOCUMENT_ICON_BLOCK,
	POST_TITLE_BLOCK,
	DOCUMENT_PROPERTIES_BLOCK,
];
const EXPECTED_HEADER_PREFIX = [ DOCUMENT_ICON_BLOCK, POST_TITLE_BLOCK ];
const BODY_A = 'Header guard body A';
const BODY_B = 'Header guard body B';
const INSERTED_BODY = 'Header guard inserted at zero';
const DOCUMENT_ICON_META = JSON.stringify( { type: 'emoji', value: 'P' } );
const DISABLE_HEADER_BOUNDARY_MOVE_UP_CLASS =
	'cortext-disable-header-boundary-move-up';

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

async function waitForEditorPost( page, postId ) {
	await page.waitForFunction(
		( expectedPostId ) =>
			window.wp?.data?.select( 'core/editor' )?.getCurrentPostId?.() ===
			expectedPostId,
		postId,
		{ timeout: 15_000 }
	);
}

function bodyMarkup() {
	return [
		`<!-- wp:paragraph --><p>${ BODY_A }</p><!-- /wp:paragraph -->`,
		`<!-- wp:paragraph --><p>${ BODY_B }</p><!-- /wp:paragraph -->`,
	].join( '\n\n' );
}

async function readHeaderState( page ) {
	return page.evaluate( ( headerBlockNames ) => {
		const blocks = window.wp.data.select( 'core/block-editor' ).getBlocks();
		const titleIndex = blocks.findIndex(
			( block ) => block.name === 'core/post-title'
		);
		if ( titleIndex === -1 ) {
			return { headerPrefix: [], bodyBeforeTitle: [] };
		}
		return {
			headerPrefix: blocks
				.slice( 0, titleIndex + 1 )
				.map( ( block ) => block.name ),
			bodyBeforeTitle: blocks
				.slice( 0, titleIndex )
				.filter(
					( block ) => ! headerBlockNames.includes( block.name )
				)
				.map( ( block ) => block.name ),
		};
	}, HEADER_BLOCK_NAMES );
}

async function expectHeaderPrefix( page ) {
	await expect
		.poll( () => readHeaderState( page ) )
		.toEqual( {
			headerPrefix: EXPECTED_HEADER_PREFIX,
			bodyBeforeTitle: [],
		} );
}

async function readParagraphsAfterTitle( page ) {
	return page.evaluate( () => {
		const getParagraphText = ( block ) => {
			const content = block.attributes?.content ?? '';
			if ( typeof content?.text === 'string' ) {
				return content.text;
			}
			const element = document.createElement( 'div' );
			element.innerHTML = String( content );
			return element.textContent || String( content );
		};
		const blocks = window.wp.data.select( 'core/block-editor' ).getBlocks();
		const titleIndex = blocks.findIndex(
			( block ) => block.name === 'core/post-title'
		);
		return blocks
			.slice( titleIndex + 1 )
			.filter( ( block ) => block.name === 'core/paragraph' )
			.map( getParagraphText );
	} );
}

async function expectParagraphsAfterTitle( page, expected ) {
	await expect
		.poll( () => readParagraphsAfterTitle( page ) )
		.toEqual( expected );
}

async function insertParagraphAt( page, content, index ) {
	await page.evaluate(
		( args ) => {
			const block = window.wp.blocks.createBlock( 'core/paragraph', {
				content: args.content,
			} );
			window.wp.data
				.dispatch( 'core/block-editor' )
				.insertBlocks( block, args.index, undefined, false );
		},
		{ content, index }
	);
}

async function moveParagraphToIndex( page, content, index ) {
	await page.evaluate(
		( args ) => {
			const getParagraphText = ( candidate ) => {
				const blockContent = candidate.attributes?.content ?? '';
				if ( typeof blockContent?.text === 'string' ) {
					return blockContent.text;
				}
				const element = document.createElement( 'div' );
				element.innerHTML = String( blockContent );
				return element.textContent || String( blockContent );
			};
			const blocks = window.wp.data
				.select( 'core/block-editor' )
				.getBlocks();
			const block = blocks.find(
				( candidate ) =>
					candidate.name === 'core/paragraph' &&
					getParagraphText( candidate ) === args.content
			);
			if ( ! block ) {
				throw new Error( `Paragraph not found: ${ args.content }` );
			}
			window.wp.data
				.dispatch( 'core/block-editor' )
				.moveBlocksToPosition( [ block.clientId ], '', '', args.index );
		},
		{ content, index }
	);
}

async function moveParagraphAfterTitle( page, content ) {
	await page.evaluate( ( paragraphContent ) => {
		const getParagraphText = ( candidate ) => {
			const blockContent = candidate.attributes?.content ?? '';
			if ( typeof blockContent?.text === 'string' ) {
				return blockContent.text;
			}
			const element = document.createElement( 'div' );
			element.innerHTML = String( blockContent );
			return element.textContent || String( blockContent );
		};
		const blocks = window.wp.data.select( 'core/block-editor' ).getBlocks();
		const titleIndex = blocks.findIndex(
			( block ) => block.name === 'core/post-title'
		);
		const block = blocks.find(
			( candidate ) =>
				candidate.name === 'core/paragraph' &&
				getParagraphText( candidate ) === paragraphContent
		);
		if ( ! block || titleIndex === -1 ) {
			throw new Error( 'Could not move paragraph after title.' );
		}
		window.wp.data
			.dispatch( 'core/block-editor' )
			.moveBlocksToPosition( [ block.clientId ], '', '', titleIndex + 1 );
	}, content );
}

async function selectParagraph( page, content ) {
	await page.evaluate( ( paragraphContent ) => {
		const getParagraphText = ( candidate ) => {
			const blockContent = candidate.attributes?.content ?? '';
			if ( typeof blockContent?.text === 'string' ) {
				return blockContent.text;
			}
			const element = document.createElement( 'div' );
			element.innerHTML = String( blockContent );
			return element.textContent || String( blockContent );
		};
		const blocks = window.wp.data.select( 'core/block-editor' ).getBlocks();
		const block = blocks.find(
			( candidate ) =>
				candidate.name === 'core/paragraph' &&
				getParagraphText( candidate ) === paragraphContent
		);
		if ( ! block ) {
			throw new Error( `Paragraph not found: ${ paragraphContent }` );
		}
		window.wp.data
			.dispatch( 'core/block-editor' )
			.selectBlock( block.clientId );
	}, content );
}

async function expectMoveUpToolbarState( page, content, shouldBeEnabled ) {
	await selectParagraph( page, content );
	await expect
		.poll( () =>
			page.evaluate(
				( className ) => document.body.classList.contains( className ),
				DISABLE_HEADER_BOUNDARY_MOVE_UP_CLASS
			)
		)
		.toBe( ! shouldBeEnabled );
	await page.evaluate( () => {
		const toolbarRoot = document.querySelector(
			'.cortext-canvas__block-canvas'
		);
		if ( ! toolbarRoot ) {
			throw new Error( 'Header guard toolbar root not found.' );
		}
		const probeRoot =
			toolbarRoot.querySelector(
				'.block-editor-block-list__block-popover, .block-editor-block-contextual-toolbar, .block-editor-block-toolbar'
			) || toolbarRoot;
		const button = document.createElement( 'button' );
		button.className = 'block-editor-block-mover-button is-up-button';
		button.dataset.testid = 'header-boundary-move-up-probe';
		button.textContent = 'Move up';
		probeRoot.appendChild( button );
	} );
	const upButton = page.locator(
		'[data-testid="header-boundary-move-up-probe"]'
	);
	await expect( upButton ).toBeVisible();
	if ( shouldBeEnabled ) {
		await expect( upButton ).toBeEnabled();
	} else {
		await expect( upButton ).toBeDisabled();
	}
	await upButton.evaluate( ( node ) => node.remove() );
}

async function expectProtectedInsertionPointHidden( page ) {
	await page.evaluate( () => {
		window.wp.data
			.dispatch( 'core/block-editor' )
			.showInsertionPoint( '', 0 );
	} );
	await expect
		.poll( () =>
			page.evaluate( () =>
				window.wp.data
					.select( 'core/block-editor' )
					.isBlockInsertionPointVisible()
			)
		)
		.toBe( false );
}

async function expectInsertionPointAllowedAfterHeader( page ) {
	const allowedIndex = await page.evaluate( ( headerNames ) => {
		const blocks = window.wp.data.select( 'core/block-editor' ).getBlocks();
		let lastHeaderIndex = -1;
		blocks.forEach( ( block, idx ) => {
			if ( headerNames.includes( block.name ) ) {
				lastHeaderIndex = idx;
			}
		} );
		const index = lastHeaderIndex + 1;
		window.wp.data
			.dispatch( 'core/block-editor' )
			.showInsertionPoint( '', index );
		return index;
	}, HEADER_BLOCK_NAMES );
	await expect
		.poll( () =>
			page.evaluate( () => {
				const store = window.wp.data.select( 'core/block-editor' );
				const insertionPoint = store.getBlockInsertionPoint();
				return {
					visible: store.isBlockInsertionPointVisible(),
					rootClientId: insertionPoint?.rootClientId ?? '',
					index: insertionPoint?.index ?? -1,
				};
			} )
		)
		.toEqual( {
			visible: true,
			rootClientId: '',
			index: allowedIndex,
		} );
	await page.evaluate( () => {
		window.wp.data.dispatch( 'core/block-editor' ).hideInsertionPoint();
	} );
}

async function exerciseHeaderGuard( page ) {
	await expectHeaderPrefix( page );
	await expectParagraphsAfterTitle( page, [ BODY_A, BODY_B ] );

	await moveParagraphAfterTitle( page, BODY_B );
	await expectHeaderPrefix( page );
	await expectParagraphsAfterTitle( page, [ BODY_B, BODY_A ] );

	await insertParagraphAt( page, INSERTED_BODY, 0 );
	await expectHeaderPrefix( page );
	await expectParagraphsAfterTitle( page, [ INSERTED_BODY, BODY_B, BODY_A ] );

	await moveParagraphToIndex( page, BODY_A, 0 );
	await expectHeaderPrefix( page );
	await expectParagraphsAfterTitle( page, [ BODY_A, INSERTED_BODY, BODY_B ] );
	await expectMoveUpToolbarState( page, BODY_A, false );
	await expectMoveUpToolbarState( page, INSERTED_BODY, true );

	await expectProtectedInsertionPointHidden( page );
	await expectInsertionPointAllowedAfterHeader( page );
}

async function createRowFixture( requestUtils ) {
	const suffix = Date.now().toString( 36 ).slice( -4 );
	const slug = `e2ehdr${ suffix }`;
	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_traits',
		data: {
			title: `E2E Header Collection ${ suffix }`,
			status: 'private',
			meta: { slug },
		},
	} );
	const row = await requestUtils.rest( {
		method: 'POST',
		path: `/wp/v2/crtxt_${ slug }`,
		data: {
			title: `E2E Header Row ${ suffix }`,
			status: 'private',
			content: bodyMarkup(),
			meta: { cortext_document_icon: DOCUMENT_ICON_META },
		},
	} );
	return { collection, row, slug };
}

test.describe( 'editor header blocks', () => {
	test( 'keeps page body blocks below the locked header prefix', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let createdPage;
		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_pages',
				data: {
					title: 'E2E Header Guard Page',
					status: 'private',
					content: bodyMarkup(),
					meta: { cortext_document_icon: DOCUMENT_ICON_META },
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ createdPage.id }`
			);
			await waitForEditorPost( page, createdPage.id );
			await exerciseHeaderGuard( page );
		} finally {
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_pages/${ createdPage.id }`
			);
		}
	} );

	test( 'keeps row body blocks below the locked header prefix', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let fixture;
		try {
			fixture = await createRowFixture( requestUtils );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.row.id }`
			);
			await waitForEditorPost( page, fixture.row.id );
			await exerciseHeaderGuard( page );
		} finally {
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_${ fixture.slug }/${ fixture.row.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_traits/${ fixture.collection.id }`
			);
		}
	} );
} );
