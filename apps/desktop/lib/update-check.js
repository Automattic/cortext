const https = require( 'https' );
const { app, dialog, shell } = require( 'electron' );
const { parseVersion, isNewer } = require( './version' );

const RELEASES_API =
	'https://api.github.com/repos/Automattic/cortext/releases?per_page=10';
const RELEASES_URL = 'https://github.com/Automattic/cortext/releases';

function fetchReleases() {
	return new Promise( ( resolve, reject ) => {
		const req = https.get(
			RELEASES_API,
			{
				headers: {
					'User-Agent': 'cortext-desktop',
					Accept: 'application/vnd.github+json',
				},
				timeout: 5000,
			},
			( res ) => {
				if ( res.statusCode !== 200 ) {
					res.resume();
					reject(
						new Error( `GitHub API responded ${ res.statusCode }` )
					);
					return;
				}
				let body = '';
				res.on( 'data', ( chunk ) => {
					body += chunk;
				} );
				res.on( 'end', () => {
					try {
						resolve( JSON.parse( body ) );
					} catch ( err ) {
						reject( err );
					}
				} );
			}
		);
		req.on( 'timeout', () =>
			req.destroy( new Error( 'request timed out' ) )
		);
		req.on( 'error', reject );
	} );
}

function latestRelease( releases ) {
	return releases
		.filter( ( release ) => release && ! release.draft )
		.map( ( release ) => ( {
			tag: release.tag_name,
			version: parseVersion( release.tag_name ),
		} ) )
		.filter( ( release ) => release.version )
		.sort( ( a, b ) => ( isNewer( a.version, b.version ) ? -1 : 1 ) )[ 0 ];
}

async function checkForUpdates() {
	const current = parseVersion( app.getVersion() );
	if ( ! current ) {
		return;
	}
	const latest = latestRelease( await fetchReleases() );
	if ( ! latest || ! isNewer( latest.version, current ) ) {
		return;
	}
	const { response } = await dialog.showMessageBox( {
		type: 'info',
		message: 'A new version of Cortext is available',
		detail: `You have ${ app.getVersion() }. The latest is ${
			latest.tag
		}.`,
		buttons: [ 'Download', 'Later' ],
		defaultId: 0,
		cancelId: 1,
	} );
	if ( response === 0 ) {
		await shell.openExternal( RELEASES_URL );
	}
}

// Fire-and-forget: only the shipped app checks, and any failure (offline, rate
// limit, no releases yet) is swallowed so it never blocks startup.
function scheduleUpdateCheck() {
	if ( ! app.isPackaged ) {
		return;
	}
	checkForUpdates().catch( ( err ) => {
		console.log( '[cortext-desktop] update check skipped:', err.message );
	} );
}

module.exports = { scheduleUpdateCheck, parseVersion, isNewer, latestRelease };
