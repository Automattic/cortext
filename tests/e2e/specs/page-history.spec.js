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

function updateDocumentWithRevisionBypass( id, title, body ) {
	const encodedPayload = Buffer.from(
		JSON.stringify( {
			id,
			title,
			content: paragraph( body ),
		} )
	).toString( 'base64' );
	const code = `
$payload = json_decode( base64_decode( '${ encodedPayload }' ), true );
$result = Cortext\\Editor\\RevisionThrottle::with_bypass(
	static function () use ( $payload ) {
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
				OLD_BODY
			);
			await delay( 1100 );
			updateDocumentWithRevisionBypass(
				createdPage.id,
				CURRENT_TITLE,
				CURRENT_BODY
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
