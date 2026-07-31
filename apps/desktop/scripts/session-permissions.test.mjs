import assert from 'node:assert/strict';
import test from 'node:test';

import sessionPermissionsModule from '../lib/session-permissions.js';

const { installSessionPermissions, isPermissionAllowed } =
	sessionPermissionsModule;
const RUNTIME_ORIGIN = 'http://127.0.0.1:43123';

function allowed( permission, requestingUrl, runtimeOrigin = RUNTIME_ORIGIN ) {
	return isPermissionAllowed( {
		permission,
		requestingUrl,
		runtimeOrigin,
	} );
}

function makeSession() {
	const handlers = {};
	const session = {
		setDevicePermissionHandler( handler ) {
			handlers.device = handler;
		},
		setDisplayMediaRequestHandler( handler ) {
			handlers.displayMedia = handler;
		},
		setPermissionCheckHandler( handler ) {
			handlers.check = handler;
		},
		setPermissionRequestHandler( handler ) {
			handlers.request = handler;
		},
	};
	return { handlers, session };
}

function requestPermission( handler, permission, details ) {
	let decision;
	handler(
		{},
		permission,
		( allowedDecision ) => {
			decision = allowedDecision;
		},
		details
	);
	return decision;
}

test( 'allows only listed permissions', () => {
	for ( const requestingUrl of [
		`${ RUNTIME_ORIGIN }/wp-admin/`,
		'http://embed.example/video',
		'https://embed.example/video',
	] ) {
		assert.equal( allowed( 'fullscreen', requestingUrl ), true );
	}

	assert.equal(
		allowed( 'clipboard-sanitized-write', `${ RUNTIME_ORIGIN }/wp-admin/` ),
		true
	);

	for ( const permission of [
		'mediaKeySystem',
		'storage-access',
		'top-level-storage-access',
	] ) {
		assert.equal(
			allowed( permission, `${ RUNTIME_ORIGIN }/document/` ),
			true
		);
		assert.equal(
			allowed( permission, 'https://embed.example/content' ),
			true
		);
	}
} );

test( 'requires the exact runtime origin and HTTPS for embeds', () => {
	assert.equal(
		allowed( 'clipboard-sanitized-write', 'http://127.0.0.1:43124/' ),
		false
	);
	assert.equal(
		allowed(
			'clipboard-sanitized-write',
			'http://127.0.0.1:43123.example/'
		),
		false
	);

	for ( const permission of [
		'mediaKeySystem',
		'storage-access',
		'top-level-storage-access',
	] ) {
		assert.equal(
			allowed( permission, 'http://embed.example/content' ),
			false
		);
		assert.equal(
			allowed( permission, 'https://embed.example:443/content' ),
			true
		);
	}
} );

test( 'denies unlisted permissions and invalid URLs', () => {
	for ( const permission of [
		'clipboard-read',
		'deprecated-sync-clipboard-read',
		'display-capture',
		'fileSystem',
		'geolocation',
		'hid',
		'idle-detection',
		'keyboardLock',
		'media',
		'midi',
		'midiSysex',
		'notifications',
		'openExternal',
		'pointerLock',
		'serial',
		'speaker-selection',
		'usb',
		'window-management',
		'unknown',
		'future-electron-permission',
		undefined,
	] ) {
		assert.equal(
			allowed( permission, `${ RUNTIME_ORIGIN }/wp-admin/` ),
			false
		);
	}

	for ( const requestingUrl of [
		undefined,
		null,
		'',
		'not a URL',
		'about:blank',
		'data:text/html,test',
		'file:///tmp/test.html',
		'ftp://example.com/',
		'https://user:password@example.com/',
	] ) {
		assert.equal( allowed( 'fullscreen', requestingUrl ), false );
	}

	assert.equal(
		allowed( 'fullscreen', 'https://example.com/', 'not a URL' ),
		false
	);
} );

test( 'rejects missing or conflicting permission request URLs', () => {
	const { handlers, session } = makeSession();
	installSessionPermissions( session, `${ RUNTIME_ORIGIN }/ignored/path` );

	assert.equal(
		handlers.check( null, 'fullscreen', 'https://video.example', {
			isMainFrame: false,
		} ),
		true
	);
	assert.equal(
		handlers.check( null, 'fullscreen', 'https://video.example', {
			isMainFrame: false,
			requestingUrl: 'https://video.example/watch',
		} ),
		true
	);

	for ( const [ requestingOrigin, details ] of [
		[ 'not a URL', { isMainFrame: false } ],
		[ 'https://video.example', null ],
		[
			'https://video.example',
			{ isMainFrame: false, requestingUrl: 'not a URL' },
		],
		[
			'https://video.example',
			{
				isMainFrame: false,
				requestingUrl: 'https://other.example/watch',
			},
		],
		[
			'https://video.example',
			{
				isMainFrame: false,
				securityOrigin: 'https://other.example',
			},
		],
	] ) {
		assert.equal(
			handlers.check( null, 'fullscreen', requestingOrigin, details ),
			false
		);
	}

	assert.equal(
		requestPermission( handlers.request, 'fullscreen', {
			isMainFrame: false,
			requestingUrl: 'https://video.example/watch',
		} ),
		true
	);

	for ( const details of [
		undefined,
		{},
		{ requestingUrl: 'not a URL' },
		{
			requestingUrl: 'https://video.example/watch',
			securityOrigin: 'https://other.example',
		},
	] ) {
		assert.equal(
			requestPermission( handlers.request, 'fullscreen', details ),
			false
		);
	}
} );

test( 'denies device and screen capture', () => {
	const { handlers, session } = makeSession();
	installSessionPermissions( session, RUNTIME_ORIGIN );

	assert.equal(
		handlers.device( {
			deviceType: 'usb',
			origin: RUNTIME_ORIGIN,
			device: {},
		} ),
		false
	);

	let displayDecision;
	handlers.displayMedia(
		{
			securityOrigin: RUNTIME_ORIGIN,
			videoRequested: true,
		},
		( streams ) => {
			displayDecision = streams;
		}
	);
	assert.deepEqual( displayDecision, {} );
} );

test( 'rejects an invalid origin and allows cleanup to run twice', () => {
	const { handlers, session } = makeSession();
	assert.throws(
		() => installSessionPermissions( session, 'file:///tmp/runtime' ),
		/runtimeOrigin must be a valid HTTP\(S\) URL/
	);

	const remove = installSessionPermissions( session, RUNTIME_ORIGIN );
	remove();
	remove();

	assert.deepEqual( handlers, {
		check: null,
		request: null,
		device: null,
		displayMedia: null,
	} );
} );
