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
const COLLECTION_LEGACY_BODY = 'Collection legacy body block';
const COLLECTION_BLOCKED_BODY = 'Collection blocked new body';
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

function paragraphMarkup( text ) {
	return `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
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

async function selectFirstBlockByName( page, blockName ) {
	await page.evaluate( ( name ) => {
		const block = window.wp.data
			.select( 'core/block-editor' )
			.getBlocks()
			.find( ( candidate ) => candidate.name === name );
		if ( ! block ) {
			throw new Error( `Block not found: ${ name }` );
		}
		window.wp.data
			.dispatch( 'core/block-editor' )
			.selectBlock( block.clientId );
	}, blockName );
}

async function readCollectionBodyState( page, collectionId ) {
	return page.evaluate(
		( { blockedText, legacyText, postId } ) => {
			const getParagraphText = ( block ) => {
				const content = block.attributes?.content ?? '';
				if ( typeof content?.text === 'string' ) {
					return content.text;
				}
				const element = document.createElement( 'div' );
				element.innerHTML = String( content );
				return element.textContent || String( content );
			};
			const blocks = window.wp.data
				.select( 'core/block-editor' )
				.getBlocks();
			const ownerBlocks = blocks.filter(
				( block ) =>
					block.name === 'cortext/data-view' &&
					Number( block.attributes?.collectionId ) ===
						Number( postId )
			);
			const legacyBlock = blocks.find(
				( block ) =>
					block.name === 'core/paragraph' &&
					getParagraphText( block ) === legacyText
			);
			return {
				blockedCount: blocks.filter(
					( block ) =>
						block.name === 'core/paragraph' &&
						getParagraphText( block ) === blockedText
				).length,
				legacyLock: legacyBlock?.attributes?.lock ?? null,
				legacyPresent: Boolean( legacyBlock ),
				ownerCount: ownerBlocks.length,
			};
		},
		{
			blockedText: COLLECTION_BLOCKED_BODY,
			legacyText: COLLECTION_LEGACY_BODY,
			postId: collectionId,
		}
	);
}

async function expectCollectionBodyState( page, collectionId, expected ) {
	await expect
		.poll( () => readCollectionBodyState( page, collectionId ), {
			timeout: 15_000,
		} )
		.toMatchObject( expected );
}

async function attemptCollectionBodyMutations( page, collectionId ) {
	await page.evaluate(
		( { blockedText, postId } ) => {
			const select = window.wp.data.select( 'core/block-editor' );
			const dispatch = window.wp.data.dispatch( 'core/block-editor' );
			const blocks = select.getBlocks();
			const ownerBlock = blocks.find(
				( block ) =>
					block.name === 'cortext/data-view' &&
					Number( block.attributes?.collectionId ) ===
						Number( postId )
			);
			if ( ! ownerBlock ) {
				throw new Error( 'Owner data-view block not found.' );
			}
			dispatch.selectBlock( ownerBlock.clientId );
			dispatch.duplicateBlocks( [ ownerBlock.clientId ], false );
			dispatch.insertBeforeBlock( ownerBlock.clientId );
			dispatch.insertAfterBlock( ownerBlock.clientId );
			dispatch.insertBlocks(
				window.wp.blocks.createBlock( 'core/paragraph', {
					content: blockedText,
				} ),
				blocks.length,
				undefined,
				false
			);
		},
		{ blockedText: COLLECTION_BLOCKED_BODY, postId: collectionId }
	);
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

async function createRowFixture(
	requestUtils,
	{ content = bodyMarkup(), withField = false } = {}
) {
	const suffix = Date.now().toString( 36 ).slice( -4 );
	const collection = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			title: `E2E Header Collection ${ suffix }`,
			status: 'private',
			cortext_collection: true,
		},
	} );
	let field = null;
	if ( withField ) {
		field = await requestUtils.rest( {
			method: 'POST',
			path: '/wp/v2/crtxt_fields',
			data: {
				title: `E2E Header Field ${ suffix }`,
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
	}
	const row = await requestUtils.rest( {
		method: 'POST',
		path: '/wp/v2/crtxt_documents',
		data: {
			title: `E2E Header Row ${ suffix }`,
			status: 'private',
			cortext_trait: collection.id,
			content,
			meta: { cortext_document_icon: DOCUMENT_ICON_META },
		},
	} );
	return { collection, field, row };
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
				path: '/wp/v2/crtxt_documents',
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
				createdPage && `/wp/v2/crtxt_documents/${ createdPage.id }`
			);
		}
	} );

	test( 'adds the first empty body block after page and row headers', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let createdPage;
		let fixture;
		try {
			createdPage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: 'E2E Empty Body Page',
					status: 'private',
					content: '',
					meta: { cortext_document_icon: DOCUMENT_ICON_META },
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ createdPage.id }`
			);
			await waitForEditorPost( page, createdPage.id );
			await expectHeaderPrefix( page );
			const editorCanvas = page.frameLocator(
				'iframe[name="editor-canvas"]'
			);

			await selectFirstBlockByName( page, DOCUMENT_ICON_BLOCK );
			await expect(
				editorCanvas.getByRole( 'button', {
					name: 'Add block after',
				} )
			).toHaveCount( 0 );

			await selectFirstBlockByName( page, POST_TITLE_BLOCK );
			await expect(
				editorCanvas.getByRole( 'button', {
					name: 'Add block after',
				} )
			).toHaveCount( 0 );
			await expectParagraphsAfterTitle( page, [ '' ] );

			fixture = await createRowFixture( requestUtils, {
				content: '',
				withField: true,
			} );
			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ fixture.row.id }`
			);
			await waitForEditorPost( page, fixture.row.id );
			await expectParagraphsAfterTitle( page, [ '' ] );
			await selectFirstBlockByName( page, DOCUMENT_PROPERTIES_BLOCK );
			await expect(
				editorCanvas.getByRole( 'button', {
					name: 'Add block after',
				} )
			).toHaveCount( 0 );
		} finally {
			await deleteIfCreated(
				requestUtils,
				createdPage && `/wp/v2/crtxt_documents/${ createdPage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_documents/${ fixture.row.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_documents/${ fixture.collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture?.field && `/wp/v2/crtxt_fields/${ fixture.field.id }`
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
				fixture && `/wp/v2/crtxt_documents/${ fixture.row.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture && `/wp/v2/crtxt_documents/${ fixture.collection.id }`
			);
			await deleteIfCreated(
				requestUtils,
				fixture?.field && `/wp/v2/crtxt_fields/${ fixture.field.id }`
			);
		}
	} );

	test( 'keeps legacy collection body blocks locked and removes new ones', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let collection;
		try {
			collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: 'E2E Collection With Legacy Body',
					status: 'private',
					cortext_collection: true,
					content: paragraphMarkup( COLLECTION_LEGACY_BODY ),
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ collection.id }`
			);
			await waitForEditorPost( page, collection.id );
			const editorCanvas = page.frameLocator(
				'iframe[name="editor-canvas"]'
			);
			await expectCollectionBodyState( page, collection.id, {
				blockedCount: 0,
				legacyLock: {
					edit: true,
					move: true,
					remove: true,
				},
				legacyPresent: true,
				ownerCount: 1,
			} );

			await attemptCollectionBodyMutations( page, collection.id );

			await expectCollectionBodyState( page, collection.id, {
				blockedCount: 0,
				legacyPresent: true,
				ownerCount: 1,
			} );
			await selectFirstBlockByName( page, POST_TITLE_BLOCK );
			await expect(
				editorCanvas.getByRole( 'button', {
					name: 'Add block after',
				} )
			).toHaveCount( 0 );
		} finally {
			await deleteIfCreated(
				requestUtils,
				collection && `/wp/v2/crtxt_documents/${ collection.id }`
			);
		}
	} );

	test( 'preserves legacy collection body blocks after switching documents', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		const suffix = Date.now().toString( 36 ).slice( -4 );
		const sourceTitle = `E2E Switch Source ${ suffix }`;
		const collectionTitle = `E2E Switch Collection ${ suffix }`;
		let sourcePage;
		let collection;
		try {
			sourcePage = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: sourceTitle,
					status: 'private',
					content: bodyMarkup(),
				},
			} );
			collection = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: collectionTitle,
					status: 'private',
					cortext_collection: true,
					content: paragraphMarkup( COLLECTION_LEGACY_BODY ),
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ sourcePage.id }`
			);
			await waitForEditorPost( page, sourcePage.id );
			await expectParagraphsAfterTitle( page, [ BODY_A, BODY_B ] );

			await page
				.locator( '.cortext-sidebar' )
				.getByRole( 'button', {
					name: collectionTitle,
					exact: true,
				} )
				.click();
			await waitForEditorPost( page, collection.id );
			await expectCollectionBodyState( page, collection.id, {
				blockedCount: 0,
				legacyLock: {
					edit: true,
					move: true,
					remove: true,
				},
				legacyPresent: true,
				ownerCount: 1,
			} );
		} finally {
			await deleteIfCreated(
				requestUtils,
				sourcePage && `/wp/v2/crtxt_documents/${ sourcePage.id }`
			);
			await deleteIfCreated(
				requestUtils,
				collection && `/wp/v2/crtxt_documents/${ collection.id }`
			);
		}
	} );
} );
