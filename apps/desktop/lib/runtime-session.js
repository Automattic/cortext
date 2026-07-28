function hasOrigin( requestUrl, origin ) {
	try {
		return new URL( requestUrl ).origin === origin;
	} catch {
		return false;
	}
}

// Chromium resolves `frame.origin` through `about:blank` and `about:srcdoc`
// inheritance, so embedded third-party content cannot borrow the runtime origin
// by nesting a frame or opening a popup.
function isTrustedRuntimeFrame( frame, runtimeOrigin, trustedDocumentUrls ) {
	if ( ! frame ) {
		// Service workers and main-process requests arrive without a frame, and
		// embedded content can register a worker, so no frame is never Cortext.
		return false;
	}
	try {
		return (
			frame.origin === runtimeOrigin ||
			trustedDocumentUrls.includes( frame.url )
		);
	} catch {
		// Reading a frame that was disposed mid-request throws.
		return false;
	}
}

function installRuntimeAuthHeader(
	runtimeSession,
	{ authHeader, authToken, runtimeOrigin, trustedDocumentUrls = [] }
) {
	if ( typeof authToken !== 'string' || ! authToken.trim() ) {
		throw new Error(
			'installRuntimeAuthHeader requires a non-empty authToken.'
		);
	}
	if ( typeof authHeader !== 'string' || ! authHeader.trim() ) {
		throw new Error(
			'installRuntimeAuthHeader requires a non-empty authHeader.'
		);
	}

	const normalizedOrigin = new URL( runtimeOrigin ).origin;
	const normalizedAuthHeader = authHeader.toLowerCase();
	const redirectedOutsideRuntime = new Set();
	const filter = { urls: [ '<all_urls>' ] };

	const onBeforeRedirect = ( details ) => {
		if (
			! hasOrigin( details.url, normalizedOrigin ) ||
			! hasOrigin( details.redirectURL, normalizedOrigin )
		) {
			redirectedOutsideRuntime.add( details.id );
		}
	};
	const onBeforeSendHeaders = ( details, callback ) => {
		const requestHeaders = { ...details.requestHeaders };
		for ( const header of Object.keys( requestHeaders ) ) {
			if ( header.toLowerCase() === normalizedAuthHeader ) {
				delete requestHeaders[ header ];
			}
		}

		if (
			hasOrigin( details.url, normalizedOrigin ) &&
			! redirectedOutsideRuntime.has( details.id ) &&
			isTrustedRuntimeFrame(
				details.frame,
				normalizedOrigin,
				trustedDocumentUrls
			)
		) {
			requestHeaders[ authHeader ] = authToken;
		} else if ( ! hasOrigin( details.url, normalizedOrigin ) ) {
			// Keep the whole redirect chain unauthenticated if it ever leaves the
			// private runtime origin.
			redirectedOutsideRuntime.add( details.id );
		}

		callback( { requestHeaders } );
	};
	const clearRequest = ( details ) => {
		redirectedOutsideRuntime.delete( details.id );
	};

	runtimeSession.webRequest.onBeforeRedirect( filter, onBeforeRedirect );
	runtimeSession.webRequest.onBeforeSendHeaders(
		filter,
		onBeforeSendHeaders
	);
	runtimeSession.webRequest.onCompleted( filter, clearRequest );
	runtimeSession.webRequest.onErrorOccurred( filter, clearRequest );

	let installed = true;
	return () => {
		if ( ! installed ) {
			return;
		}
		installed = false;
		runtimeSession.webRequest.onBeforeRedirect( null );
		runtimeSession.webRequest.onBeforeSendHeaders( null );
		runtimeSession.webRequest.onCompleted( null );
		runtimeSession.webRequest.onErrorOccurred( null );
		redirectedOutsideRuntime.clear();
	};
}

module.exports = {
	hasOrigin,
	installRuntimeAuthHeader,
	isTrustedRuntimeFrame,
};
