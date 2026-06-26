/**
 * E2E coverage for visual revision history in the Cortext shell.
 *
 * Requires the native editor revisions engine. On older editors the "History"
 * action is disabled and this flow does not apply.
 */

const fs = require( 'fs' );
const path = require( 'path' );
const { execFileSync } = require( 'child_process' );
const { test, expect } = require( '@wordpress/e2e-test-utils-playwright' );

const SUFFIX = Date.now().toString( 36 ).slice( -4 );
const SEED_TITLE = `E2E History Seed ${ SUFFIX }`;
const OLD_TITLE = `E2E History Old ${ SUFFIX }`;
const CURRENT_TITLE = `E2E History Current ${ SUFFIX }`;
const SEED_BODY = `Seed revision body ${ SUFFIX }`;
const OLD_BODY = `Old revision body ${ SUFFIX }`;
const CURRENT_BODY = `Current revision body ${ SUFFIX }`;
const OLD_ICON_VALUE = String.fromCodePoint( 0x1f535 );
const CURRENT_ICON_VALUE = String.fromCodePoint( 0x1f7e2 );
const OLD_ICON = JSON.stringify( { type: 'emoji', value: OLD_ICON_VALUE } );
const CURRENT_ICON = JSON.stringify( {
	type: 'emoji',
	value: CURRENT_ICON_VALUE,
} );
const PROJECT_ROOT = path.resolve( __dirname, '../../..' );

function readWpEnvPort( configPath ) {
	try {
		const config = JSON.parse(
			fs.readFileSync( path.join( PROJECT_ROOT, configPath ), 'utf8' )
		);
		return config.port ? Number( config.port ) : null;
	} catch {
		return null;
	}
}

function baseUrlPort() {
	try {
		const { port, protocol } = new URL( process.env.WP_BASE_URL );
		if ( port ) {
			return Number( port );
		}
		return protocol === 'https:' ? 443 : 80;
	} catch {
		return null;
	}
}

function resolveWpEnvConfig() {
	const port = baseUrlPort();
	if ( port && port === readWpEnvPort( '.wp-env.test.json' ) ) {
		return '.wp-env.test.json';
	}
	return null;
}

function runWpCli( args ) {
	const wpEnvBin = path.join(
		PROJECT_ROOT,
		'node_modules',
		'.bin',
		process.platform === 'win32' ? 'wp-env.cmd' : 'wp-env'
	);
	const wpEnvConfig = resolveWpEnvConfig();
	const configArgs = wpEnvConfig ? [ '--config', wpEnvConfig ] : [];

	return execFileSync(
		wpEnvBin,
		[ ...configArgs, 'run', 'cli', 'wp', ...args ],
		{
			cwd: PROJECT_ROOT,
			encoding: 'utf8',
			stdio: [ 'ignore', 'pipe', 'pipe' ],
		}
	);
}

function paragraph( text ) {
	return `<!-- wp:paragraph --><p>${ text }</p><!-- /wp:paragraph -->`;
}

async function delay( ms ) {
	await new Promise( ( resolve ) => setTimeout( resolve, ms ) );
}

function updateDocumentWithRevisionBypass( id, title, body, icon = '' ) {
	const encodedPayload = Buffer.from(
		JSON.stringify( {
			id,
			title,
			content: paragraph( body ),
			icon,
		} )
	).toString( 'base64' );
	const code = `
$payload = json_decode( base64_decode( '${ encodedPayload }' ), true );
$result = Cortext\\Editor\\RevisionThrottle::with_bypass(
	static function () use ( $payload ) {
		update_post_meta(
			(int) $payload['id'],
			'cortext_document_icon',
			wp_slash( (string) ( $payload['icon'] ?? '' ) )
		);
		return wp_update_post(
			array(
				'ID'           => (int) $payload['id'],
				'post_status'  => 'private',
				'post_title'   => $payload['title'],
				'post_content' => $payload['content'],
			),
			true
		);
	}
);
if ( is_wp_error( $result ) ) {
	fwrite( STDERR, $result->get_error_message() );
	exit( 1 );
}
`;

	runWpCli( [ 'eval', code ] );
}

function sidebarRowForTitle( page, title ) {
	return page
		.locator( '#cortext-sidebar-section-pages .cortext-sidebar__row' )
		.filter( {
			has: page.locator( '.cortext-sidebar__title', {
				hasText: title,
			} ),
		} )
		.first();
}

function sidebarEmojiIconForTitle( page, title ) {
	return sidebarRowForTitle( page, title )
		.locator(
			'.cortext-sidebar__icon .cortext-document-icon--emoji img.emoji'
		)
		.first();
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
		// Best-effort cleanup; the test may have already removed the page.
	}
}

test.describe( 'Visual revision history', () => {
	test( 'preview an older revision and restore it from the shell', async ( {
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
					title: SEED_TITLE,
					content: paragraph( SEED_BODY ),
					status: 'private',
				},
			} );

			// The app throttles rapid autosave revisions. The fixture uses the
			// same scoped bypass as restore so the test can create two immediate
			// snapshots without waiting for the production throttle window.
			updateDocumentWithRevisionBypass(
				createdPage.id,
				OLD_TITLE,
				OLD_BODY,
				OLD_ICON
			);
			await delay( 1100 );
			updateDocumentWithRevisionBypass(
				createdPage.id,
				CURRENT_TITLE,
				CURRENT_BODY,
				CURRENT_ICON
			);

			await admin.visitAdminPage(
				'admin.php',
				`page=cortext&p=/${ createdPage.id }`
			);

			await page.waitForFunction(
				( postId ) =>
					window.wp?.data
						?.select( 'core/editor' )
						?.getCurrentPostId?.() === postId,
				createdPage.id,
				{ timeout: 15_000 }
			);

			const currentSidebarRow = sidebarRowForTitle( page, CURRENT_TITLE );
			await expect( currentSidebarRow ).toBeVisible();
			await expect(
				sidebarEmojiIconForTitle( page, CURRENT_TITLE )
			).toHaveAttribute( 'alt', CURRENT_ICON_VALUE );

			// Open the history panel from the editor top bar.
			await page
				.locator( '.cortext-document-actions' )
				.getByRole( 'button', { name: 'History' } )
				.click();

			const panel = page.locator( '.cortext-revision-history' );
			await expect( panel ).toBeVisible();

			// Selecting a revision drops the canvas into read-only revisions
			// mode and swaps the top bar for the revisions header.
			const previousRevision = panel
				.locator( '.cortext-revision-history__button' )
				.filter( { hasNotText: 'Current' } )
				.first();
			await expect( previousRevision ).toBeVisible();
			await previousRevision.click();

			const header = page.locator( '.cortext-revisions-header' );
			await expect( header ).toBeVisible();

			await header
				.getByRole( 'button', { name: 'Restore revision' } )
				.click();

			await page
				.getByRole( 'dialog' )
				.getByRole( 'button', { name: 'Restore', exact: true } )
				.click();

			// The live document rolls back to the older revision.
			await expect
				.poll( async () => {
					const restored = await requestUtils.rest( {
						path: `/wp/v2/crtxt_documents/${ createdPage.id }`,
						params: { context: 'edit' },
					} );
					return restored.title.raw;
				} )
				.toBe( OLD_TITLE );

			const restored = await requestUtils.rest( {
				path: `/wp/v2/crtxt_documents/${ createdPage.id }`,
				params: { context: 'edit' },
			} );
			expect( restored.content.raw ).toContain( OLD_BODY );

			await expect( header ).toBeHidden();
			const canvas = page.frameLocator( '[name="editor-canvas"]' );
			await expect(
				canvas.locator( '.cortext-canvas__editor' )
			).toContainText( OLD_BODY );
			await expect(
				canvas.locator( '.cortext-canvas__editor' )
			).not.toContainText( CURRENT_BODY );

			const restoredSidebarRow = sidebarRowForTitle( page, OLD_TITLE );
			await expect( restoredSidebarRow ).toBeVisible();
			await expect(
				sidebarEmojiIconForTitle( page, OLD_TITLE )
			).toHaveAttribute( 'alt', OLD_ICON_VALUE );
			await expect(
				sidebarEmojiIconForTitle( page, OLD_TITLE )
			).not.toHaveAttribute( 'alt', CURRENT_ICON_VALUE );

			// The pre-restore (CURRENT) version stays available in history so
			// the restore is reversible.
			await expect
				.poll( async () => {
					const history = await requestUtils.rest( {
						path: `/wp/v2/crtxt_documents/${ createdPage.id }/revisions`,
						params: { context: 'edit', per_page: 100 },
					} );
					return history.some(
						( revision ) => revision.title.raw === CURRENT_TITLE
					);
				} )
				.toBe( true );

			// The restored state also becomes the latest revision; otherwise
			// reopening history after a restore marks the pre-restore snapshot
			// as "Current" and the visual history feels broken.
			await expect
				.poll( async () => {
					const history = await requestUtils.rest( {
						path: `/wp/v2/crtxt_documents/${ createdPage.id }/revisions`,
						params: { context: 'edit', per_page: 100 },
					} );
					return history[ 0 ]?.title.raw;
				} )
				.toBe( OLD_TITLE );
		} finally {
			await deleteIfCreated( requestUtils, createdPage?.id );
		}
	} );
} );
