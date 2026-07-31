const { spawn } = require( 'child_process' );
const fs = require( 'fs' );
const http = require( 'http' );
const net = require( 'net' );
const os = require( 'os' );
const path = require( 'path' );
const { bundledRuntimeExecutable, findExecutable } = require( './executable' );

// Existing profiles used this origin before runtime ports became per-profile.
// Keeping it as their first preference preserves origin-scoped browser state.
const LEGACY_PORT = 9402;
// Ports offered to a profile that has no preference yet. The band starts just
// past the legacy port so an upgrading profile keeps its claim on that one, and
// sits below the ephemeral range the kernel hands out for outbound sockets
// (49152+ on macOS, 32768+ on Linux). A port saved from that range would be
// competing with the short-lived loopback traffic churning through it.
const RUNTIME_PORT_FIRST = 9403;
const RUNTIME_PORT_LAST = 9498;
const DEFAULT_READY_PATH = '/wp-includes/images/blank.gif';
const RUNTIME_AUTH_HEADER = 'X-Cortext-Desktop-Token';
const RUNTIME_AUTH_ENV = 'CORTEXT_DESKTOP_AUTH_TOKEN';
const WINDOWS_DIRECT_EXECUTABLE_EXTENSIONS = [ '.COM', '.EXE' ];
const RUNTIME_HOST_ENV = 'CORTEXT_DESKTOP_RUNTIME_HOST';
const RUNTIME_ORIGIN_ENV = 'CORTEXT_DESKTOP_RUNTIME_ORIGIN';
const RUNTIME_BOOTSTRAP_ENV = 'CORTEXT_DESKTOP_RUNTIME_BOOTSTRAP';
const EXPLORATION_OBJECT_CACHE_MARKER =
	'Cortext Desktop APCu object-cache exploration drop-in';

function normalizeRuntime( runtime ) {
	const value = ( runtime || 'php' ).toLowerCase();
	if ( [ 'php', 'php-cli', 'cli', 'php-s' ].includes( value ) ) {
		return 'php';
	}
	if ( [ 'franken', 'frankenphp' ].includes( value ) ) {
		return 'franken';
	}
	if ( [ 'php-fpm', 'fpm' ].includes( value ) ) {
		return 'php-fpm';
	}
	throw new Error(
		`Unsupported CORTEXT_RUNTIME="${ runtime }". Expected php, franken, or php-fpm.`
	);
}

function findRuntimeExecutable( command, options = {} ) {
	const platform = options.platform ?? process.platform;
	return findExecutable( command, {
		...options,
		platform,
		allowedWindowsExtensions:
			platform === 'win32' ? WINDOWS_DIRECT_EXECUTABLE_EXTENSIONS : null,
	} );
}

function resolveExecutable( envName, bundledPath, commandName, installHint ) {
	const configured = process.env[ envName ];
	if ( configured ) {
		const resolved = findRuntimeExecutable( configured );
		if ( resolved ) {
			return resolved;
		}
		throw new Error(
			`${ envName } does not point to an executable: ${ configured }`
		);
	}
	if ( bundledPath && fs.existsSync( bundledPath ) ) {
		return bundledPath;
	}
	const fromPath = findRuntimeExecutable( commandName );
	if ( fromPath ) {
		return fromPath;
	}
	throw new Error(
		`${ commandName } was not found. ${ installHint } To use a different executable, set ${ envName } to its path.`
	);
}

function pipeProcessOutput( child, onOutput ) {
	const quiet = process.env.CORTEXT_RUNTIME_QUIET === '1';
	child.stdout.on( 'data', ( chunk ) => {
		onOutput( chunk );
		if ( ! quiet ) {
			process.stdout.write( chunk );
		}
	} );
	child.stderr.on( 'data', ( chunk ) => {
		onOutput( chunk );
		if ( ! quiet ) {
			process.stderr.write( chunk );
		}
	} );
}

function isEnabled( value ) {
	return [ '1', 'true', 'yes', 'on' ].includes(
		String( value || '' ).toLowerCase()
	);
}

function addPhpIni( args, key, value ) {
	// PHP parses -d values with php.ini grammar even when Node passes argv
	// directly. Quote paths so Windows short names such as RUNNER~1 are not
	// treated as expressions, and keep literal path characters literal.
	const encodedValue = String( value )
		.replaceAll( '\\', '\\\\' )
		.replaceAll( '"', '\\"' )
		.replaceAll( '$', '\\$' );
	args.push( '-d', `${ key }="${ encodedValue }"` );
}

function ensureDir( dir ) {
	fs.mkdirSync( dir, { recursive: true } );
	return dir;
}

function configureObjectCacheDropIn( wordpressDir, appDir ) {
	const dropInPath = path.join( wordpressDir, 'wp-content/object-cache.php' );
	const sourcePath = path.join( appDir, 'runtime/object-cache-apcu.php' );

	if ( process.env.CORTEXT_DESKTOP_OBJECT_CACHE === 'apcu' ) {
		if ( ! fs.existsSync( sourcePath ) ) {
			throw new Error(
				`APCu object-cache drop-in not found at ${ sourcePath }.`
			);
		}
		fs.copyFileSync( sourcePath, dropInPath );
		return;
	}

	if ( ! fs.existsSync( dropInPath ) ) {
		return;
	}

	const existing = fs.readFileSync( dropInPath, 'utf8' );
	if ( existing.includes( EXPLORATION_OBJECT_CACHE_MARKER ) ) {
		fs.rmSync( dropInPath, { force: true } );
	}
}

function configureDesktopUpdateLock( wordpressDir, appDir ) {
	const sourcePath = path.join(
		appDir,
		'runtime/mu-plugins/cortext-update-lock.php'
	);
	const muPluginsDir = path.join( wordpressDir, 'wp-content/mu-plugins' );

	if ( ! fs.existsSync( sourcePath ) ) {
		throw new Error(
			`Desktop update lock mu-plugin not found at ${ sourcePath }.`
		);
	}

	fs.mkdirSync( muPluginsDir, { recursive: true } );
	fs.copyFileSync(
		sourcePath,
		path.join( muPluginsDir, 'cortext-update-lock.php' )
	);
}

function configureRuntimeRouter( wordpressDir, appDir ) {
	const sourcePath = path.join( appDir, 'runtime/router.php' );
	if ( ! fs.existsSync( sourcePath ) ) {
		throw new Error(
			`Authenticated desktop router not found at ${ sourcePath }.`
		);
	}

	fs.copyFileSync( sourcePath, path.join( wordpressDir, 'router.php' ) );
}

function configureRuntimeBootstrap( wordpressDir, appDir ) {
	const sourcePath = path.join( appDir, 'runtime/bootstrap.php' );
	if ( ! fs.existsSync( sourcePath ) ) {
		throw new Error(
			`Desktop runtime bootstrap not found at ${ sourcePath }.`
		);
	}

	const bootstrapPath = path.join(
		wordpressDir,
		'cortext-runtime-bootstrap.php'
	);
	fs.copyFileSync( sourcePath, bootstrapPath );
	return bootstrapPath;
}

function configurePreloadFiles( wordpressDir, appDir ) {
	const files = [
		[ 'preload.php', 'cortext-preload.php' ],
		[ 'preload-manifest.php', 'cortext-preload-manifest.php' ],
	];

	for ( const [ sourceName, destName ] of files ) {
		const source = path.join( appDir, 'runtime', sourceName );
		if ( ! fs.existsSync( source ) ) {
			throw new Error( `Preload file not found at ${ source }.` );
		}
		fs.copyFileSync( source, path.join( wordpressDir, destName ) );
	}

	return path.join( wordpressDir, 'cortext-preload.php' );
}

function phpCliIniArgs( wordpressDir, appDir, runtimeStateDir ) {
	const args = [];
	const needsOpcache =
		isEnabled( process.env.CORTEXT_PHP_OPCACHE_FILE_CACHE ) ||
		isEnabled( process.env.CORTEXT_PHP_PRELOAD ) ||
		isEnabled( process.env.CORTEXT_PHP_JIT );

	if ( needsOpcache ) {
		addPhpIni( args, 'opcache.enable_cli', '1' );
		addPhpIni( args, 'opcache.enable', '1' );
		addPhpIni( args, 'opcache.validate_timestamps', '0' );
	}

	if ( isEnabled( process.env.CORTEXT_PHP_OPCACHE_FILE_CACHE ) ) {
		const fileCacheDir = ensureDir(
			path.join( runtimeStateDir, 'opcache-file-cache' )
		);
		addPhpIni( args, 'opcache.file_cache', fileCacheDir );
		addPhpIni( args, 'opcache.file_cache_only', '0' );
	}

	if ( isEnabled( process.env.CORTEXT_PHP_PRELOAD ) ) {
		const preloadPath = configurePreloadFiles( wordpressDir, appDir );
		const markerPath = path.join(
			ensureDir( runtimeStateDir ),
			'preload-engagement.json'
		);
		process.env.CORTEXT_DESKTOP_PRELOAD_MARKER = markerPath;
		addPhpIni( args, 'opcache.preload', preloadPath );
	} else {
		delete process.env.CORTEXT_DESKTOP_PRELOAD_MARKER;
	}

	if ( isEnabled( process.env.CORTEXT_PHP_JIT ) ) {
		addPhpIni(
			args,
			'opcache.jit_buffer_size',
			process.env.CORTEXT_PHP_JIT_BUFFER_SIZE || '64M'
		);
		addPhpIni(
			args,
			'opcache.jit',
			process.env.CORTEXT_PHP_JIT_MODE || 'tracing'
		);
		addPhpIni( args, 'pcre.jit', '1' );
	}

	if ( process.env.CORTEXT_DESKTOP_OBJECT_CACHE === 'apcu' ) {
		addPhpIni( args, 'apc.enabled', '1' );
		addPhpIni( args, 'apc.enable_cli', '1' );
	}

	return args;
}

function childProcessOptions( options = {} ) {
	return {
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		...options,
		windowsHide: true,
	};
}

function addProcess( handle, name, command, args, options = {} ) {
	const child = spawn( command, args, childProcessOptions( options ) );
	const entry = {
		name,
		child,
		killProcessGroup: options.detached === true,
		expectedExit: false,
		outputClosed: false,
		outputTail: '',
	};
	handle.processes.push( entry );
	pipeProcessOutput( child, ( chunk ) => {
		entry.outputTail = `${ entry.outputTail }${ chunk }`.slice( -8192 );
	} );
	child.once( 'close', () => {
		entry.outputClosed = true;
	} );

	child.on( 'exit', ( code, signal ) => {
		console.log(
			`[cortext-desktop] ${ name } exited (code=${ code }, signal=${ signal })`
		);
		if (
			! handle.stopping &&
			! handle.starting &&
			! entry.expectedExit &&
			typeof handle.onUnexpectedExit === 'function'
		) {
			handle.onUnexpectedExit( name, code, signal );
		}
	} );

	return child;
}

function phpCliWorkerConfig( env = process.env, platform = process.platform ) {
	const configured =
		env.CORTEXT_PHP_CLI_SERVER_WORKERS ||
		env.PHP_CLI_SERVER_WORKERS ||
		null;

	if ( platform === 'win32' ) {
		return {
			workers: null,
			detached: false,
			ignoredWorkers: configured,
		};
	}

	return {
		workers: configured,
		detached: Number.parseInt( configured || '1', 10 ) > 1,
		ignoredWorkers: null,
	};
}

function waitForHttpReady(
	handle,
	port,
	authToken,
	runtimeOrigin,
	timeoutMs = 30000
) {
	return new Promise( ( resolve, reject ) => {
		let settled = false;
		let lastFailure = null;
		let probeTimer = null;
		const activeRequests = new Set();
		const timeout = setTimeout( () => {
			fail(
				new Error(
					`Runtime startup timed out (${
						timeoutMs / 1000
					}s). Last failure: ${
						lastFailure ? String( lastFailure ) : 'no HTTP response'
					}`
				)
			);
		}, timeoutMs );

		const cleanupFns = [];
		const cleanup = () => {
			clearTimeout( timeout );
			if ( probeTimer ) {
				clearTimeout( probeTimer );
			}
			for ( const request of activeRequests ) {
				request.destroy();
			}
			activeRequests.clear();
			for ( const fn of cleanupFns ) {
				fn();
			}
		};
		const fail = ( err ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			cleanup();
			reject( err );
		};
		const pass = () => {
			if ( settled ) {
				return;
			}
			settled = true;
			cleanup();
			resolve();
		};

		for ( const { name, child } of handle.processes ) {
			const onError = ( err ) => fail( err );
			const onExit = ( code, signal ) => {
				fail(
					new Error(
						`${ name } exited before the HTTP server became ready (code=${ code }, signal=${ signal })`
					)
				);
			};
			child.once( 'error', onError );
			child.once( 'exit', onExit );
			cleanupFns.push( () => {
				child.off( 'error', onError );
				child.off( 'exit', onExit );
			} );
		}

		const requestStatus = ( headers = {} ) =>
			new Promise( ( resolveStatus, rejectRequest ) => {
				const request = http.get(
					{
						host: '127.0.0.1',
						port,
						path: DEFAULT_READY_PATH,
						timeout: 1000,
						headers,
					},
					( response ) => {
						response.resume();
						response.once( 'end', () => {
							resolveStatus( response.statusCode );
						} );
					}
				);
				activeRequests.add( request );
				request.once( 'close', () => {
					activeRequests.delete( request );
				} );
				request.once( 'timeout', () => {
					request.destroy( new Error( 'HTTP probe timed out' ) );
				} );
				request.once( 'error', rejectRequest );
			} );

		const probe = async () => {
			if ( settled ) {
				return;
			}

			try {
				const unauthenticatedStatus = await requestStatus();
				if ( settled ) {
					return;
				}
				if ( unauthenticatedStatus !== 403 ) {
					fail(
						new Error(
							`Runtime security check failed: unauthenticated request returned HTTP ${ unauthenticatedStatus }.`
						)
					);
					return;
				}

				const invalidTokenStatus = await requestStatus( {
					[ RUNTIME_AUTH_HEADER ]: `${ authToken }-invalid`,
				} );
				if ( settled ) {
					return;
				}
				if ( invalidTokenStatus !== 403 ) {
					fail(
						new Error(
							`Runtime security check failed: invalid token request returned HTTP ${ invalidTokenStatus }.`
						)
					);
					return;
				}

				const invalidHostStatus = await requestStatus( {
					Host: `localhost:${ port }`,
					[ RUNTIME_AUTH_HEADER ]: authToken,
				} );
				if ( settled ) {
					return;
				}
				if ( invalidHostStatus !== 403 ) {
					fail(
						new Error(
							`Runtime security check failed: invalid Host request returned HTTP ${ invalidHostStatus }.`
						)
					);
					return;
				}

				const invalidOriginStatus = await requestStatus( {
					Origin: 'https://example.com',
					[ RUNTIME_AUTH_HEADER ]: authToken,
				} );
				if ( settled ) {
					return;
				}
				if ( invalidOriginStatus !== 403 ) {
					fail(
						new Error(
							`Runtime security check failed: invalid Origin request returned HTTP ${ invalidOriginStatus }.`
						)
					);
					return;
				}

				const authenticatedStatus = await requestStatus( {
					Origin: runtimeOrigin,
					[ RUNTIME_AUTH_HEADER ]: authToken,
				} );
				if ( settled ) {
					return;
				}
				if (
					authenticatedStatus &&
					authenticatedStatus >= 200 &&
					authenticatedStatus < 400
				) {
					pass();
					return;
				}
				fail(
					new Error(
						`Runtime security check failed: authenticated request returned HTTP ${ authenticatedStatus }.`
					)
				);
			} catch ( error ) {
				lastFailure = error.message;
				if ( ! settled ) {
					probeTimer = setTimeout( probe, 250 );
				}
			}
		};

		probe();
	} );
}

function startPhpCli(
	handle,
	wordpressDir,
	port,
	appDir,
	runtimeStateDir,
	runtimeEnvironment,
	bootstrapPath
) {
	const phpBin = resolveExecutable(
		'CORTEXT_PHP_BIN',
		bundledRuntimeExecutable( appDir, 'php' ),
		'php',
		`Install PHP 8.1+ or include ${ bundledRuntimeExecutable(
			'apps/desktop',
			'php'
		) } in the app bundle.`
	);
	const routerPath = path.join( wordpressDir, 'router.php' );
	if ( ! fs.existsSync( routerPath ) ) {
		throw new Error(
			`router.php not found at ${ routerPath }. The snapshot is missing runtime files.`
		);
	}
	console.log(
		`[cortext-desktop] starting php -S (127.0.0.1:${ port }) against ${ wordpressDir }`
	);
	const workerConfig = phpCliWorkerConfig();
	const phpIniArgs = phpCliIniArgs( wordpressDir, appDir, runtimeStateDir );
	addPhpIni( phpIniArgs, 'auto_prepend_file', bootstrapPath );
	const phpArgs = [
		...phpIniArgs,
		'-S',
		`127.0.0.1:${ port }`,
		'-t',
		wordpressDir,
		routerPath,
	];
	const phpEnv = {
		...process.env,
		...runtimeEnvironment,
	};
	if ( process.platform === 'win32' ) {
		delete phpEnv.CORTEXT_PHP_CLI_SERVER_WORKERS;
		delete phpEnv.PHP_CLI_SERVER_WORKERS;
		if ( workerConfig.ignoredWorkers ) {
			console.warn(
				'[cortext-desktop] Windows does not support multiple PHP CLI server workers; using one worker.'
			);
		}
	} else if ( workerConfig.workers ) {
		phpEnv.PHP_CLI_SERVER_WORKERS = workerConfig.workers;
	}
	addProcess( handle, 'php', phpBin, phpArgs, {
		cwd: wordpressDir,
		env: phpEnv,
		detached: workerConfig.detached,
	} );
}

function startFrankenPhp(
	handle,
	wordpressDir,
	port,
	appDir,
	runtimeEnvironment
) {
	const frankenBin = resolveExecutable(
		'CORTEXT_FRANKENPHP_BIN',
		bundledRuntimeExecutable( appDir, 'frankenphp' ),
		'frankenphp',
		'Place the FrankenPHP binary in apps/desktop/runtime/bin.'
	);
	const configPath = path.join( appDir, 'runtime/Caddyfile.frankenphp' );
	if ( ! fs.existsSync( configPath ) ) {
		throw new Error( `FrankenPHP Caddyfile not found at ${ configPath }.` );
	}
	if ( ! fs.existsSync( path.join( wordpressDir, 'worker.php' ) ) ) {
		throw new Error(
			`worker.php not found in ${ wordpressDir }. Rebuild the desktop snapshot.`
		);
	}
	console.log(
		`[cortext-desktop] starting FrankenPHP (127.0.0.1:${ port }) against ${ wordpressDir }`
	);
	addProcess(
		handle,
		'frankenphp',
		frankenBin,
		[ 'run', '--config', configPath, '--adapter', 'caddyfile' ],
		{
			cwd: wordpressDir,
			env: {
				...process.env,
				...runtimeEnvironment,
				CORTEXT_PORT: String( port ),
				CORTEXT_WORDPRESS_ROOT: wordpressDir,
				CORTEXT_CADDY_STORAGE: path.join( handle.stateDir, 'caddy' ),
				CORTEXT_FRANKEN_WORKERS:
					process.env.CORTEXT_FRANKEN_WORKERS || '1',
			},
		}
	);
}

function writePhpFpmConfig( runtimeStateDir, wordpressDir, bootstrapPath ) {
	fs.mkdirSync( runtimeStateDir, { recursive: true } );
	const socketDir = fs.mkdtempSync(
		path.join( os.tmpdir(), 'cortext-fpm-' )
	);
	const socketPath = path.join( socketDir, 'fpm.sock' );
	const configPath = path.join( runtimeStateDir, 'php-fpm.conf' );
	const children = process.env.CORTEXT_PHP_FPM_CHILDREN || '2';

	fs.rmSync( socketPath, { force: true } );
	fs.writeFileSync(
		configPath,
		[
			'[global]',
			'daemonize = no',
			`error_log = ${ path.join( runtimeStateDir, 'php-fpm.log' ) }`,
			`pid = ${ path.join( runtimeStateDir, 'php-fpm.pid' ) }`,
			'',
			'[www]',
			`listen = ${ socketPath }`,
			'listen.mode = 0600',
			'pm = static',
			`pm.max_children = ${ children }`,
			'clear_env = no',
			'catch_workers_output = yes',
			`chdir = ${ wordpressDir }`,
			`php_admin_value[doc_root] = ${ wordpressDir }`,
			`php_admin_value[error_log] = ${ path.join(
				runtimeStateDir,
				'php-errors.log'
			) }`,
			'php_admin_flag[log_errors] = on',
			`php_admin_value[auto_prepend_file] = ${ bootstrapPath }`,
			'php_value[opcache.enable] = 1',
			'php_value[opcache.validate_timestamps] = 0',
			'',
		].join( '\n' )
	);

	return { configPath, socketDir, socketPath };
}

function startPhpFpmCaddy(
	handle,
	wordpressDir,
	port,
	appDir,
	runtimeStateDir,
	runtimeEnvironment,
	bootstrapPath
) {
	const phpFpmBin = resolveExecutable(
		'CORTEXT_PHP_FPM_BIN',
		bundledRuntimeExecutable( appDir, 'php-fpm' ),
		'php-fpm',
		'Install php-fpm or include apps/desktop/runtime/bin/php-fpm in the app bundle.'
	);
	const caddyBin = resolveExecutable(
		'CORTEXT_CADDY_BIN',
		bundledRuntimeExecutable( appDir, 'caddy' ),
		'caddy',
		'Place the Caddy binary in apps/desktop/runtime/bin.'
	);
	const configPath = path.join( appDir, 'runtime/Caddyfile.php-fpm' );
	if ( ! fs.existsSync( configPath ) ) {
		throw new Error( `PHP-FPM Caddyfile not found at ${ configPath }.` );
	}

	const fpm = writePhpFpmConfig(
		runtimeStateDir,
		wordpressDir,
		bootstrapPath
	);
	handle.cleanupPaths.push( fpm.socketDir );
	console.log(
		`[cortext-desktop] starting php-fpm + Caddy (127.0.0.1:${ port }) against ${ wordpressDir }`
	);
	addProcess(
		handle,
		'php-fpm',
		phpFpmBin,
		[ '-F', '-O', '-y', fpm.configPath ],
		{
			cwd: wordpressDir,
			env: {
				...process.env,
				...runtimeEnvironment,
			},
		}
	);
	addProcess(
		handle,
		'caddy',
		caddyBin,
		[ 'run', '--config', configPath, '--adapter', 'caddyfile' ],
		{
			cwd: wordpressDir,
			env: {
				...process.env,
				...runtimeEnvironment,
				CORTEXT_PORT: String( port ),
				CORTEXT_WORDPRESS_ROOT: wordpressDir,
				CORTEXT_PHP_FPM_SOCKET: fpm.socketPath,
				CORTEXT_CADDY_STORAGE: path.join( handle.stateDir, 'caddy' ),
			},
		}
	);
}

function isValidPort( port ) {
	return Number.isInteger( port ) && port >= 1 && port <= 65535;
}

function inspectAvailablePort( port ) {
	return new Promise( ( resolve, reject ) => {
		const server = net.createServer();
		server.unref();
		server.once( 'error', reject );
		server.listen( port, '127.0.0.1', () => {
			const address = server.address();
			const selectedPort =
				address && typeof address === 'object' ? address.port : null;
			server.close( ( error ) => {
				if ( error ) {
					reject( error );
					return;
				}
				resolve( selectedPort );
			} );
		} );
	} );
}

async function claimPort( port ) {
	try {
		return { port: await inspectAvailablePort( port ) };
	} catch ( error ) {
		if ( error.code !== 'EADDRINUSE' ) {
			throw error;
		}
		return null;
	}
}

async function findAvailablePort( preferredPort ) {
	if ( preferredPort !== undefined && preferredPort !== null ) {
		if ( ! isValidPort( preferredPort ) ) {
			throw new TypeError(
				'startRuntime port must be an integer between 1 and 65535.'
			);
		}
		const preferred = await claimPort( preferredPort );
		if ( preferred ) {
			return preferred.port;
		}
	}

	for ( let port = RUNTIME_PORT_FIRST; port <= RUNTIME_PORT_LAST; port++ ) {
		const claimed = await claimPort( port );
		if ( claimed ) {
			return claimed.port;
		}
	}

	// Every band port is taken. Start anyway on whatever the kernel offers; the
	// profile loses origin stability, not the ability to run.
	return inspectAvailablePort( 0 );
}

function runtimeEndpoint( port ) {
	const host = `127.0.0.1:${ port }`;
	return {
		host,
		origin: `http://${ host }`,
		port,
	};
}

function makeRuntimeEnvironment( authToken, endpoint, bootstrapPath ) {
	return {
		[ RUNTIME_AUTH_ENV ]: authToken,
		[ RUNTIME_HOST_ENV ]: endpoint.host,
		[ RUNTIME_ORIGIN_ENV ]: endpoint.origin,
		[ RUNTIME_BOOTSTRAP_ENV ]: bootstrapPath,
	};
}

function isProcessRunning( child ) {
	return child && child.exitCode === null && child.signalCode === null;
}

function signalProcess(
	child,
	killProcessGroup,
	signal,
	platform = process.platform
) {
	if ( platform === 'win32' ) {
		child.kill();
		return;
	}
	if ( killProcessGroup && child.pid ) {
		process.kill( -child.pid, signal );
		return;
	}
	child.kill( signal );
}

function runWindowsTaskkill( pid, spawnProcess = spawn, timeoutMs = 5000 ) {
	return new Promise( ( resolve ) => {
		let killer;
		let settled = false;
		let timeout = null;
		const finish = ( succeeded ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			if ( timeout ) {
				clearTimeout( timeout );
			}
			resolve( succeeded );
		};

		try {
			killer = spawnProcess(
				'taskkill',
				[ '/PID', String( pid ), '/T', '/F' ],
				childProcessOptions( {
					stdio: [ 'ignore', 'ignore', 'ignore' ],
				} )
			);
		} catch {
			finish( false );
			return;
		}

		killer.once( 'error', () => finish( false ) );
		killer.once( 'exit', ( code ) => finish( code === 0 ) );
		timeout = setTimeout( () => {
			try {
				killer.kill();
			} catch {}
			finish( false );
		}, timeoutMs );
	} );
}

function waitForProcessExit(
	child,
	{
		killProcessGroup = false,
		gracePeriodMs = 5000,
		forcePeriodMs = 1000,
		platform = process.platform,
		runTaskkill = runWindowsTaskkill,
		sendSignal = signalProcess,
	} = {}
) {
	if ( ! isProcessRunning( child ) ) {
		return Promise.resolve();
	}

	return new Promise( ( resolve, reject ) => {
		let settled = false;
		let forceTimer = null;
		let finalTimer = null;
		const cleanup = () => {
			if ( forceTimer ) {
				clearTimeout( forceTimer );
			}
			if ( finalTimer ) {
				clearTimeout( finalTimer );
			}
			child.off( 'exit', finish );
			child.off( 'close', finish );
			child.off( 'error', onError );
		};
		const finish = () => {
			if ( settled ) {
				return;
			}
			settled = true;
			cleanup();
			resolve();
		};
		const fail = ( error ) => {
			if ( settled ) {
				return;
			}
			settled = true;
			cleanup();
			reject( error );
		};
		const onError = () => {
			if ( ! child.pid || ! isProcessRunning( child ) ) {
				finish();
			}
		};

		child.once( 'exit', finish );
		child.once( 'close', finish );
		child.once( 'error', onError );

		if ( ! isProcessRunning( child ) ) {
			finish();
			return;
		}

		try {
			sendSignal( child, killProcessGroup, 'SIGTERM', platform );
		} catch {
			if ( ! isProcessRunning( child ) ) {
				finish();
				return;
			}
		}

		if ( settled ) {
			return;
		}
		forceTimer = setTimeout( async () => {
			if ( ! isProcessRunning( child ) ) {
				finish();
				return;
			}
			try {
				if ( platform === 'win32' && child.pid ) {
					await runTaskkill( child.pid );
				} else {
					sendSignal( child, killProcessGroup, 'SIGKILL', platform );
				}
			} catch {
				if ( ! isProcessRunning( child ) ) {
					finish();
				}
			}
			if ( settled ) {
				return;
			}
			finalTimer = setTimeout( () => {
				if ( ! isProcessRunning( child ) ) {
					finish();
					return;
				}
				fail(
					new Error(
						`Runtime process ${
							child.pid || '<unknown>'
						} is still running after forced termination.`
					)
				);
			}, forcePeriodMs );
		}, gracePeriodMs );
	} );
}

function waitForProcessOutputToClose( entries, timeoutMs = 5500 ) {
	return Promise.all(
		entries.map(
			( entry ) =>
				new Promise( ( resolve ) => {
					if ( ! entry.child || entry.outputClosed ) {
						resolve();
						return;
					}
					const timer = setTimeout( () => {
						entry.child.off( 'close', onClose );
						resolve();
					}, timeoutMs );
					const onClose = () => {
						clearTimeout( timer );
						entry.child.off( 'close', onClose );
						resolve();
					};
					entry.child.once( 'close', onClose );
					if ( entry.outputClosed ) {
						onClose();
					}
				} )
		)
	);
}

function stopProcessEntries( entries, options = {} ) {
	const processes = [ ...entries ].reverse();
	for ( const entry of processes ) {
		entry.expectedExit = true;
	}
	return Promise.all(
		processes.map( ( { child, killProcessGroup } ) =>
			waitForProcessExit( child, {
				killProcessGroup,
				...options,
			} )
		)
	);
}

function isPortBindFailure( entries, port ) {
	const phpListenFailure = new RegExp(
		`failed to listen on 127\\.0\\.0\\.1:${ port }(?:\\s|$)`,
		'i'
	);
	return entries.some(
		( entry ) =>
			/(?:address already in use|eaddrinuse|bind: address|only one usage of each socket address)/i.test(
				entry.outputTail
			) || phpListenFailure.test( entry.outputTail )
	);
}

async function launchRuntime( handle, options ) {
	const {
		appDir,
		wordpressDir,
		port,
		runtimeStateDir,
		authToken,
		bootstrapPath,
		portAllocator,
	} = options;
	let selectedPort = await portAllocator( port );
	if ( ! isValidPort( selectedPort ) ) {
		throw new Error( 'Runtime port allocator returned an invalid port.' );
	}

	for ( let attempt = 0; attempt < 2; attempt++ ) {
		if ( handle.stopping ) {
			throw new Error( 'Runtime startup was cancelled.' );
		}

		const endpoint = runtimeEndpoint( selectedPort );
		const runtimeEnvironment = makeRuntimeEnvironment(
			authToken,
			endpoint,
			bootstrapPath
		);
		const processStart = handle.processes.length;
		const cleanupStart = handle.cleanupPaths.length;

		handle.port = endpoint.port;
		handle.host = endpoint.host;
		handle.origin = endpoint.origin;

		if ( handle.runtime === 'php' ) {
			startPhpCli(
				handle,
				wordpressDir,
				endpoint.port,
				appDir,
				runtimeStateDir,
				runtimeEnvironment,
				bootstrapPath
			);
		} else if ( handle.runtime === 'franken' ) {
			startFrankenPhp(
				handle,
				wordpressDir,
				endpoint.port,
				appDir,
				runtimeEnvironment
			);
		} else if ( handle.runtime === 'php-fpm' ) {
			startPhpFpmCaddy(
				handle,
				wordpressDir,
				endpoint.port,
				appDir,
				runtimeStateDir,
				runtimeEnvironment,
				bootstrapPath
			);
		}

		try {
			await waitForHttpReady(
				handle,
				endpoint.port,
				authToken,
				endpoint.origin
			);
			handle.starting = false;
			return handle;
		} catch ( error ) {
			const failedProcesses = handle.processes.splice( processStart );
			const failedCleanupPaths =
				handle.cleanupPaths.splice( cleanupStart );
			await stopProcessEntries( failedProcesses );
			// The child `exit` event may precede the final stderr data. Wait for
			// stdio to close before deciding whether this was a bind collision.
			await waitForProcessOutputToClose( failedProcesses );
			const portBindFailure = isPortBindFailure(
				failedProcesses,
				selectedPort
			);
			for ( const cleanupPath of failedCleanupPaths ) {
				fs.rmSync( cleanupPath, { recursive: true, force: true } );
			}

			if ( ! portBindFailure || attempt > 0 ) {
				throw error;
			}

			console.warn(
				`[cortext-desktop] runtime port ${ selectedPort } was claimed during startup; choosing another`
			);
			selectedPort = await portAllocator();
			if ( ! isValidPort( selectedPort ) ) {
				throw new Error(
					'Runtime port allocator returned an invalid port.'
				);
			}
		}
	}

	throw new Error( 'Unable to start the desktop runtime.' );
}

function startRuntime( {
	appDir,
	wordpressDir,
	port,
	runtime = process.env.CORTEXT_RUNTIME,
	runtimeStateDir,
	onUnexpectedExit,
	authToken,
	portAllocator = findAvailablePort,
} ) {
	if ( typeof authToken !== 'string' || authToken.trim().length === 0 ) {
		throw new TypeError( 'startRuntime requires a non-empty authToken.' );
	}
	if ( typeof portAllocator !== 'function' ) {
		throw new TypeError( 'startRuntime portAllocator must be a function.' );
	}
	if ( port !== undefined && port !== null && ! isValidPort( port ) ) {
		throw new TypeError(
			'startRuntime port must be an integer between 1 and 65535.'
		);
	}

	const normalized = normalizeRuntime( runtime );
	const handle = {
		runtime: normalized,
		processes: [],
		cleanupPaths: [],
		starting: true,
		stopping: false,
		onUnexpectedExit,
		port: null,
		host: null,
		origin: null,
	};
	const stateDir =
		runtimeStateDir ||
		fs.mkdtempSync( path.join( os.tmpdir(), 'cortext-desktop-runtime-' ) );
	handle.stateDir = stateDir;

	configureObjectCacheDropIn( wordpressDir, appDir );
	configureRuntimeRouter( wordpressDir, appDir );
	const bootstrapPath = configureRuntimeBootstrap( wordpressDir, appDir );
	configureDesktopUpdateLock( wordpressDir, appDir );

	handle.ready = launchRuntime( handle, {
		appDir,
		wordpressDir,
		port,
		runtimeStateDir: stateDir,
		authToken,
		bootstrapPath,
		portAllocator,
	} ).catch( async ( error ) => {
		if ( ! handle.stopping ) {
			// Report why startup failed, not why the cleanup afterwards did.
			await stopRuntime( handle ).catch( () => {} );
		}
		throw error;
	} );
	return handle;
}

function stopRuntime( handle, options = {} ) {
	if ( ! handle ) {
		return Promise.resolve();
	}
	if ( handle.stopPromise ) {
		return handle.stopPromise;
	}
	handle.stopping = true;

	const stopPromise = ( async () => {
		try {
			await stopProcessEntries( handle.processes || [], options );
		} finally {
			for ( const cleanupPath of handle.cleanupPaths || [] ) {
				fs.rmSync( cleanupPath, { recursive: true, force: true } );
			}
		}
	} )();
	// A failed stop timed out; it did not call the shutdown off. The signals are
	// still on their way, so leave `stopping` set and let the caller retry.
	handle.stopPromise = stopPromise.catch( ( error ) => {
		handle.stopPromise = null;
		throw error;
	} );

	return handle.stopPromise;
}

module.exports = {
	LEGACY_PORT,
	RUNTIME_AUTH_HEADER,
	RUNTIME_PORT_FIRST,
	RUNTIME_PORT_LAST,
	WINDOWS_DIRECT_EXECUTABLE_EXTENSIONS,
	childProcessOptions,
	findRuntimeExecutable,
	findAvailablePort,
	isPortBindFailure,
	isValidPort,
	normalizeRuntime,
	phpCliWorkerConfig,
	runWindowsTaskkill,
	startRuntime,
	stopRuntime,
	waitForProcessExit,
};
