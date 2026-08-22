/** E2E coverage for editor fields projected into the lazy sidebar tree. */

const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const INITIAL_EMOJI = '🏠';
const UPDATED_EMOJI = '👍';

function encodeEmoji( value ) {
	return JSON.stringify( { type: 'emoji', value } );
}

async function deleteIfCreated( requestUtils, id ) {
	if ( ! id ) {
		return;
	}
	try {
		await requestUtils.rest( {
			method: 'DELETE',
			path: `/wp/v2/crtxt_documents/${ id }`,
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

function sidebarNodeByTitle( page, title ) {
	return page
		.locator( '[data-sidebar-section="pages"] .cortext-sidebar__node', {
			has: page.getByRole( 'button', { name: title, exact: true } ),
		} )
		.first();
}

async function readSidebarIcon( node ) {
	return node.locator( '.cortext-document-icon' ).evaluate( ( icon ) => {
		return (
			icon.querySelector( 'img.emoji' )?.alt ?? icon.textContent.trim()
		);
	} );
}

async function readSavedDocument( requestUtils, id ) {
	return requestUtils.rest( {
		method: 'GET',
		path: `/wp/v2/crtxt_documents/${ id }`,
		params: { context: 'edit' },
	} );
}

test.describe( 'Sidebar document fields', () => {
	test( 'updates the active title and icon without a reload', async ( {
		admin,
		page,
		requestUtils,
	} ) => {
		let document;
		const suffix = Date.now().toString( 36 ).slice( -5 );
		const initialTitle = `E2E Sidebar Fields ${ suffix }`;
		const updatedTitle = `E2E Sidebar Updated ${ suffix }`;
		const initialIcon = encodeEmoji( INITIAL_EMOJI );
		const updatedIcon = encodeEmoji( UPDATED_EMOJI );

		try {
			document = await requestUtils.rest( {
				method: 'POST',
				path: '/wp/v2/crtxt_documents',
				data: {
					title: initialTitle,
					status: 'private',
					menu_order: -1000,
					content:
						'<!-- wp:paragraph --><p>Sidebar field test.</p><!-- /wp:paragraph -->',
					meta: { cortext_document_icon: initialIcon },
				},
			} );

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ document.id }`
			);
			await waitForEditorPost( page, document.id );

			let node = sidebarNodeByTitle( page, initialTitle );
			await expect( node ).toBeVisible();
			await expect
				.poll( () => readSidebarIcon( node ) )
				.toBe( INITIAL_EMOJI );

			const editorCanvas = page.frameLocator(
				'iframe[name="editor-canvas"]'
			);
			const titleEditor = editorCanvas
				.locator(
					'[data-type="core/post-title"][contenteditable="true"]'
				)
				.first();
			await expect( titleEditor ).toBeVisible();
			await titleEditor.fill( updatedTitle );
			await titleEditor.blur();

			node = sidebarNodeByTitle( page, updatedTitle );
			await expect( node ).toBeVisible();
			await expect
				.poll(
					async () => {
						const saved = await readSavedDocument(
							requestUtils,
							document.id
						);
						return saved?.title?.raw ?? '';
					},
					{ timeout: 15_000 }
				)
				.toBe( updatedTitle );

			const changeIcon = editorCanvas.getByRole( 'button', {
				name: 'Change icon',
			} );
			await expect( changeIcon ).toBeVisible();
			await changeIcon.evaluate( ( button ) => button.click() );

			const picker = page.locator( '.cortext-document-identity-popover' );
			await expect( picker ).toBeVisible();
			const emoji = picker
				.getByRole( 'button', { name: UPDATED_EMOJI, exact: true } )
				.first();
			await expect( emoji ).toBeVisible();
			await emoji.evaluate( ( button ) => button.click() );

			await expect
				.poll( () => readSidebarIcon( node ) )
				.toBe( UPDATED_EMOJI );
			await expect
				.poll(
					async () => {
						const saved = await readSavedDocument(
							requestUtils,
							document.id
						);
						return saved?.meta?.cortext_document_icon ?? '';
					},
					{ timeout: 15_000 }
				)
				.toBe( updatedIcon );

			const remove = picker.locator(
				'.cortext-document-identity-popover__remove'
			);
			if ( ! ( await remove.isVisible().catch( () => false ) ) ) {
				await changeIcon.evaluate( ( button ) => button.click() );
			}
			await expect( remove ).toBeVisible();
			await remove.evaluate( ( button ) => button.click() );

			await expect(
				node.locator( '.cortext-document-icon--fallback' )
			).toBeVisible();
			await expect
				.poll(
					async () => {
						const saved = await readSavedDocument(
							requestUtils,
							document.id
						);
						return saved?.meta?.cortext_document_icon ?? '';
					},
					{ timeout: 15_000 }
				)
				.toBe( '' );
		} finally {
			await deleteIfCreated( requestUtils, document?.id );
		}
	} );
} );
