import assert from 'node:assert/strict';
import test from 'node:test';

import runtimeSessionModule from '../lib/runtime-session.js';

const { installRuntimeAuthHeader } = runtimeSessionModule;
const AUTH_HEADER = 'X-Cortext-Desktop-Token';
const AUTH_TOKEN = 'private-runtime-token';
const RUNTIME_ORIGIN = 'http://127.0.0.1:9402';
const LOADING_URL = 'file:///Applications/Cortext.app/loading.html';
const RUNTIME_FRAME = {
	url: `${ RUNTIME_ORIGIN }/wp-admin/admin.php?page=cortext`,
	origin: RUNTIME_ORIGIN,
};

function makeSession() {
	const listeners = {};
	const webRequest = {};
	for ( const eventName of [
		'onBeforeRedirect',
		'onBeforeSendHeaders',
		'onCompleted',
		'onErrorOccurred',
	] ) {
		webRequest[ eventName ] = ( filter, listener ) => {
			if ( filter === null ) {
				listeners[ eventName ] = null;
				return;
			}
			listeners[ eventName ] = listener;
		};
	}
	return { listeners, session: { webRequest } };
}

function sendHeaders( listener, details ) {
	return new Promise( ( resolve ) => {
		listener(
			{
				id: 1,
				requestHeaders: {},
				frame: RUNTIME_FRAME,
				...details,
			},
			resolve
		);
	} );
}

function install( session ) {
	return installRuntimeAuthHeader( session, {
		authHeader: AUTH_HEADER,
		authToken: AUTH_TOKEN,
		runtimeOrigin: RUNTIME_ORIGIN,
		trustedDocumentUrls: [ LOADING_URL ],
	} );
}

test( 'requires a non-empty token and header name', () => {
	const { session } = makeSession();

	assert.throws(
		() =>
			installRuntimeAuthHeader( session, {
				authHeader: AUTH_HEADER,
				authToken: '',
				runtimeOrigin: RUNTIME_ORIGIN,
			} ),
		/requires a non-empty authToken/
	);
	assert.throws(
		() =>
			installRuntimeAuthHeader( session, {
				authHeader: ' ',
				authToken: AUTH_TOKEN,
				runtimeOrigin: RUNTIME_ORIGIN,
			} ),
		/requires a non-empty authHeader/
	);
} );

test( 'authenticates runtime requests and replaces spoofed headers', async () => {
	const { listeners, session } = makeSession();
	install( session );

	const result = await sendHeaders( listeners.onBeforeSendHeaders, {
		url: `${ RUNTIME_ORIGIN }/wp-admin/`,
		requestHeaders: {
			'User-Agent': 'Cortext test',
			'x-cortext-desktop-token': 'spoofed-lowercase',
			'X-CORTEXT-DESKTOP-TOKEN': 'spoofed-uppercase',
		},
	} );

	assert.deepEqual( result.requestHeaders, {
		'User-Agent': 'Cortext test',
		[ AUTH_HEADER ]: AUTH_TOKEN,
	} );
} );

test( 'never sends the runtime token to another origin', async () => {
	const { listeners, session } = makeSession();
	install( session );

	const result = await sendHeaders( listeners.onBeforeSendHeaders, {
		url: 'https://example.com/image.png',
		requestHeaders: {
			[ AUTH_HEADER ]: 'spoofed',
			Accept: 'image/*',
		},
	} );

	assert.deepEqual( result.requestHeaders, { Accept: 'image/*' } );
} );

test( 'does not authenticate a redirect chain that leaves the runtime', async () => {
	const { listeners, session } = makeSession();
	install( session );

	listeners.onBeforeRedirect( {
		id: 42,
		url: 'https://example.com/redirect',
		redirectURL: `${ RUNTIME_ORIGIN }/wp-json/`,
	} );
	const redirected = await sendHeaders( listeners.onBeforeSendHeaders, {
		id: 42,
		url: `${ RUNTIME_ORIGIN }/wp-json/`,
	} );

	assert.equal( redirected.requestHeaders[ AUTH_HEADER ], undefined );

	listeners.onErrorOccurred( { id: 42 } );
	const laterRequest = await sendHeaders( listeners.onBeforeSendHeaders, {
		id: 42,
		url: `${ RUNTIME_ORIGIN }/wp-json/`,
	} );
	assert.equal( laterRequest.requestHeaders[ AUTH_HEADER ], AUTH_TOKEN );

	await sendHeaders( listeners.onBeforeSendHeaders, {
		id: 43,
		url: 'https://example.com/redirect',
	} );
	listeners.onCompleted( { id: 43 } );
	const completedRequestId = await sendHeaders(
		listeners.onBeforeSendHeaders,
		{
			id: 43,
			url: `${ RUNTIME_ORIGIN }/wp-json/`,
		}
	);
	assert.equal(
		completedRequestId.requestHeaders[ AUTH_HEADER ],
		AUTH_TOKEN
	);
} );

test( 'authenticates the shell page navigating to the runtime', async () => {
	const { listeners, session } = makeSession();
	install( session );

	const result = await sendHeaders( listeners.onBeforeSendHeaders, {
		url: `${ RUNTIME_ORIGIN }/wp-admin/admin.php?page=cortext`,
		frame: { url: LOADING_URL, origin: 'file://' },
	} );

	assert.equal( result.requestHeaders[ AUTH_HEADER ], AUTH_TOKEN );
} );

test( 'never authenticates a request from embedded third-party content', async () => {
	const { listeners, session } = makeSession();
	install( session );

	const embeddedFrames = [
		{
			url: 'https://www.youtube.com/embed/x',
			origin: 'https://www.youtube.com',
		},
		// A frame nested inside the embed inherits the provider's origin.
		{ url: 'about:blank', origin: 'https://www.youtube.com' },
		// A popup an embed opened starts empty but keeps the opener's origin.
		{ url: '', origin: 'https://www.youtube.com' },
	];

	for ( const frame of embeddedFrames ) {
		const result = await sendHeaders( listeners.onBeforeSendHeaders, {
			url: `${ RUNTIME_ORIGIN }/wp-admin/`,
			frame,
		} );
		assert.equal( result.requestHeaders[ AUTH_HEADER ], undefined );
	}
} );

test( 'never authenticates a request that arrives without a frame', async () => {
	const { listeners, session } = makeSession();
	install( session );

	// Service workers and main-process fetches both land here, and embedded
	// content can register a worker.
	for ( const frame of [ undefined, null ] ) {
		const result = await sendHeaders( listeners.onBeforeSendHeaders, {
			url: `${ RUNTIME_ORIGIN }/wp-admin/`,
			frame,
		} );
		assert.equal( result.requestHeaders[ AUTH_HEADER ], undefined );
	}
} );

test( 'never authenticates a request whose frame was disposed', async () => {
	const { listeners, session } = makeSession();
	install( session );

	const result = await sendHeaders( listeners.onBeforeSendHeaders, {
		url: `${ RUNTIME_ORIGIN }/wp-admin/`,
		frame: {
			get origin() {
				throw new Error( 'Render frame was disposed' );
			},
		},
	} );

	assert.equal( result.requestHeaders[ AUTH_HEADER ], undefined );
} );

test( 'cleans up all dedicated-session listeners idempotently', () => {
	const { listeners, session } = makeSession();
	const remove = install( session );

	remove();
	remove();

	assert.deepEqual( listeners, {
		onBeforeRedirect: null,
		onBeforeSendHeaders: null,
		onCompleted: null,
		onErrorOccurred: null,
	} );
} );
