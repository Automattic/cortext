const HTTPS_PERMISSION_NAMES = new Set( [
	'mediaKeySystem',
	'storage-access',
	'top-level-storage-access',
] );

function webOrigin( value ) {
	if ( typeof value !== 'string' || ! value.trim() ) {
		return null;
	}

	try {
		const url = new URL( value );
		if (
			! [ 'http:', 'https:' ].includes( url.protocol ) ||
			url.username ||
			url.password
		) {
			return null;
		}
		return url.origin;
	} catch {
		return null;
	}
}

function isPermissionAllowed( { permission, requestingUrl, runtimeOrigin } ) {
	const requestingOrigin = webOrigin( requestingUrl );
	const normalizedRuntimeOrigin = webOrigin( runtimeOrigin );
	if ( ! requestingOrigin || ! normalizedRuntimeOrigin ) {
		return false;
	}

	if ( permission === 'fullscreen' ) {
		return true;
	}

	if ( permission === 'clipboard-sanitized-write' ) {
		return requestingOrigin === normalizedRuntimeOrigin;
	}

	if ( HTTPS_PERMISSION_NAMES.has( permission ) ) {
		return (
			requestingOrigin === normalizedRuntimeOrigin ||
			requestingOrigin.startsWith( 'https://' )
		);
	}

	return false;
}

function permissionCheckUrl( requestingOrigin, details ) {
	if ( ! details || typeof details !== 'object' ) {
		return null;
	}

	const normalizedRequestingOrigin = webOrigin( requestingOrigin );
	if ( ! normalizedRequestingOrigin ) {
		return null;
	}

	for ( const field of [ 'requestingUrl', 'securityOrigin' ] ) {
		if ( details[ field ] === undefined ) {
			continue;
		}
		if ( webOrigin( details[ field ] ) !== normalizedRequestingOrigin ) {
			return null;
		}
	}

	return requestingOrigin;
}

function permissionRequestUrl( details ) {
	if ( ! details || typeof details !== 'object' ) {
		return null;
	}

	const normalizedRequestingOrigin = webOrigin( details.requestingUrl );
	if ( ! normalizedRequestingOrigin ) {
		return null;
	}

	if (
		details.securityOrigin !== undefined &&
		webOrigin( details.securityOrigin ) !== normalizedRequestingOrigin
	) {
		return null;
	}

	return details.requestingUrl;
}

function installSessionPermissions( runtimeSession, runtimeOrigin ) {
	const normalizedRuntimeOrigin = webOrigin( runtimeOrigin );
	if ( ! normalizedRuntimeOrigin ) {
		throw new Error( 'runtimeOrigin must be a valid HTTP(S) URL.' );
	}

	runtimeSession.setPermissionCheckHandler(
		( _webContents, permission, requestingOrigin, details ) =>
			isPermissionAllowed( {
				permission,
				requestingUrl: permissionCheckUrl( requestingOrigin, details ),
				runtimeOrigin: normalizedRuntimeOrigin,
			} )
	);
	runtimeSession.setPermissionRequestHandler(
		( _webContents, permission, callback, details ) => {
			callback(
				isPermissionAllowed( {
					permission,
					requestingUrl: permissionRequestUrl( details ),
					runtimeOrigin: normalizedRuntimeOrigin,
				} )
			);
		}
	);
	runtimeSession.setDevicePermissionHandler( () => false );
	runtimeSession.setDisplayMediaRequestHandler( ( _request, callback ) =>
		callback( {} )
	);

	let installed = true;
	return () => {
		if ( ! installed ) {
			return;
		}
		installed = false;

		runtimeSession.setPermissionCheckHandler( null );
		runtimeSession.setPermissionRequestHandler( null );
		runtimeSession.setDevicePermissionHandler( null );
		runtimeSession.setDisplayMediaRequestHandler( null );
	};
}

module.exports = {
	installSessionPermissions,
	isPermissionAllowed,
};
