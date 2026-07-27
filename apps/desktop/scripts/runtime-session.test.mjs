import assert from 'node:assert/strict';
import test from 'node:test';

import runtimeSessionModule from '../lib/runtime-session.js';

const { installRuntimeAuthHeader } = runtimeSessionModule;
const AUTH_HEADER = 'X-Cortext-Desktop-Token';
const AUTH_TOKEN = 'private-runtime-token';
const RUNTIME_ORIGIN = 'http://127.0.0.1:9402';

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
				...details,
			},
			resolve
		);
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
	installRuntimeAuthHeader( session, {
		authHeader: AUTH_HEADER,
		authToken: AUTH_TOKEN,
		runtimeOrigin: RUNTIME_ORIGIN,
	} );

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
	installRuntimeAuthHeader( session, {
		authHeader: AUTH_HEADER,
		authToken: AUTH_TOKEN,
		runtimeOrigin: RUNTIME_ORIGIN,
	} );

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
	installRuntimeAuthHeader( session, {
		authHeader: AUTH_HEADER,
		authToken: AUTH_TOKEN,
		runtimeOrigin: RUNTIME_ORIGIN,
	} );

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

test( 'cleans up all dedicated-session listeners idempotently', () => {
	const { listeners, session } = makeSession();
	const remove = installRuntimeAuthHeader( session, {
		authHeader: AUTH_HEADER,
		authToken: AUTH_TOKEN,
		runtimeOrigin: RUNTIME_ORIGIN,
	} );

	remove();
	remove();

	assert.deepEqual( listeners, {
		onBeforeRedirect: null,
		onBeforeSendHeaders: null,
		onCompleted: null,
		onErrorOccurred: null,
	} );
} );
