const fs = require( 'fs' );
const path = require( 'path' );

const DEFAULT_WINDOWS_PATHEXT = '.COM;.EXE;.BAT;.CMD';

function envValue( env, name, platform = process.platform ) {
	if ( platform !== 'win32' ) {
		return env[ name ];
	}

	const key = Object.keys( env ).find(
		( candidate ) => candidate.toLowerCase() === name.toLowerCase()
	);
	return key ? env[ key ] : undefined;
}

function defaultIsFile( candidate, platform ) {
	try {
		if ( ! fs.statSync( candidate ).isFile() ) {
			return false;
		}
		if ( platform !== 'win32' ) {
			fs.accessSync( candidate, fs.constants.X_OK );
		}
		return true;
	} catch {
		return false;
	}
}

function bundledRuntimeExecutable(
	appDir,
	commandName,
	platform = process.platform
) {
	const pathApi = platform === 'win32' ? path.win32 : path;
	const executable =
		platform === 'win32' && ! commandName.toLowerCase().endsWith( '.exe' )
			? `${ commandName }.exe`
			: commandName;
	return pathApi.join( appDir, 'runtime/bin', executable );
}

function windowsExtensions(
	command,
	env,
	pathApi,
	allowedWindowsExtensions = null
) {
	const allowed = allowedWindowsExtensions
		? new Set(
				allowedWindowsExtensions.map( ( extension ) =>
					extension.toLowerCase()
				)
		  )
		: null;
	const configured =
		envValue( env, 'PATHEXT', 'win32' ) || DEFAULT_WINDOWS_PATHEXT;
	const extensions = configured
		.split( ';' )
		.map( ( extension ) => extension.trim() )
		.filter( Boolean )
		.map( ( extension ) =>
			extension.startsWith( '.' ) ? extension : `.${ extension }`
		)
		.filter(
			( extension ) => ! allowed || allowed.has( extension.toLowerCase() )
		);
	const commandExtension = pathApi.extname( command ).toLowerCase();

	if ( commandExtension ) {
		return extensions.some(
			( extension ) => extension.toLowerCase() === commandExtension
		)
			? [ '' ]
			: [];
	}

	return [ '', ...extensions ];
}

function findExecutable(
	command,
	{
		env = process.env,
		platform = process.platform,
		cwd = process.cwd(),
		isFile = ( candidate ) => defaultIsFile( candidate, platform ),
		allowedWindowsExtensions = null,
	} = {}
) {
	if ( typeof command !== 'string' || ! command.trim() ) {
		return null;
	}

	const trimmed = command.trim().replace( /^"(.*)"$/, '$1' );
	const pathApi = platform === 'win32' ? path.win32 : path;
	const extensions =
		platform === 'win32'
			? windowsExtensions(
					trimmed,
					env,
					pathApi,
					allowedWindowsExtensions
			  )
			: [ '' ];
	const check = ( base ) => {
		for ( const extension of extensions ) {
			const candidate = `${ base }${ extension }`;
			if ( isFile( candidate ) ) {
				return candidate;
			}
		}
		return null;
	};

	const isPath =
		pathApi.isAbsolute( trimmed ) ||
		trimmed.includes( '/' ) ||
		trimmed.includes( '\\' ) ||
		( platform === 'win32' && /^[A-Za-z]:/.test( trimmed ) );

	if ( isPath ) {
		const candidate = pathApi.isAbsolute( trimmed )
			? trimmed
			: pathApi.resolve( cwd, trimmed );
		return check( candidate );
	}

	const pathValue = envValue( env, 'PATH', platform );
	if ( ! pathValue ) {
		return null;
	}

	for ( const rawDir of pathValue.split( pathApi.delimiter ) ) {
		const unquoted = rawDir.trim().replace( /^"(.*)"$/, '$1' );
		const dir = unquoted || cwd;
		const found = check( pathApi.join( dir, trimmed ) );
		if ( found ) {
			return found;
		}
	}

	return null;
}

module.exports = {
	DEFAULT_WINDOWS_PATHEXT,
	bundledRuntimeExecutable,
	envValue,
	findExecutable,
};
