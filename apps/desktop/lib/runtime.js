const { spawn, spawnSync } = require( 'child_process' );
const fs = require( 'fs' );
const http = require( 'http' );
const os = require( 'os' );
const path = require( 'path' );

const DEFAULT_PORT = 9402;
const DEFAULT_READY_PATH = '/wp-includes/images/blank.gif';

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

function commandExists( command ) {
	if ( command.includes( path.sep ) ) {
		return fs.existsSync( command );
	}
	const result = spawnSync( 'which', [ command ], {
		stdio: [ 'ignore', 'pipe', 'ignore' ],
		encoding: 'utf8',
	} );
	return result.status === 0 ? result.stdout.trim() : null;
}

function resolveExecutable( envName, bundledPath, commandName, installHint ) {
	const configured = process.env[ envName ];
	if ( configured ) {
		if ( fs.existsSync( configured ) || commandExists( configured ) ) {
			return configured;
		}
		throw new Error( `${ envName } points to a missing executable: ${ configured }` );
	}
	if ( bundledPath && fs.existsSync( bundledPath ) ) {
		return bundledPath;
	}
	const fromPath = commandExists( commandName );
	if ( fromPath ) {
		return fromPath;
	}
	throw new Error(
		`Missing ${ commandName }. ${ installHint } Set ${ envName } to an executable path to override.`
	);
}

function pipeProcessOutput( child ) {
	if ( process.env.CORTEXT_RUNTIME_QUIET === '1' ) {
		child.stdout.resume();
		child.stderr.resume();
		return;
	}
	child.stdout.on( 'data', ( chunk ) => {
		process.stdout.write( chunk );
	} );
	child.stderr.on( 'data', ( chunk ) => {
		process.stderr.write( chunk );
	} );
}

function addProcess( handle, name, command, args, options = {} ) {
	const child = spawn( command, args, {
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		...options,
	} );
	handle.processes.push( {
		name,
		child,
		killProcessGroup: options.detached === true,
	} );
	pipeProcessOutput( child );

	child.on( 'exit', ( code, signal ) => {
		console.log(
			`[cortext-desktop] ${ name } exited (code=${ code }, signal=${ signal })`
		);
		if ( ! handle.stopping && typeof handle.onUnexpectedExit === 'function' ) {
			handle.onUnexpectedExit( name, code, signal );
		}
	} );

	return child;
}

function waitForHttpReady( handle, port, timeoutMs = 30000 ) {
	return new Promise( ( resolve, reject ) => {
		let settled = false;
		let lastFailure = null;
		let probeTimer = null;
		const timeout = setTimeout( () => {
			fail(
				new Error(
					`Runtime startup timed out (${ timeoutMs / 1000 }s). Last failure: ${
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

		const probe = () => {
			const req = http.get(
				{
					host: '127.0.0.1',
					port,
					path: DEFAULT_READY_PATH,
					timeout: 1000,
				},
				( res ) => {
					res.resume();
					if ( res.statusCode && res.statusCode < 500 ) {
						pass();
						return;
					}
					lastFailure = `HTTP ${ res.statusCode }`;
					probeTimer = setTimeout( probe, 250 );
				}
			);
			req.on( 'timeout', () => {
				req.destroy( new Error( 'HTTP probe timed out' ) );
			} );
			req.on( 'error', ( err ) => {
				lastFailure = err.message;
				if ( ! settled ) {
					probeTimer = setTimeout( probe, 250 );
				}
			} );
		};

		probe();
	} );
}

function startPhpCli( handle, wordpressDir, port, appDir ) {
	const phpBin = resolveExecutable(
		'CORTEXT_PHP_BIN',
		path.join( appDir, 'runtime/bin/php' ),
		'php',
		'Install PHP 8.1+ or bundle apps/desktop/runtime/bin/php.'
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
	const workers =
		process.env.CORTEXT_PHP_CLI_SERVER_WORKERS ||
		process.env.PHP_CLI_SERVER_WORKERS;
	const phpEnv = { ...process.env };
	if ( workers ) {
		phpEnv.PHP_CLI_SERVER_WORKERS = workers;
	}
	addProcess(
		handle,
		'php',
		phpBin,
		[ '-S', `127.0.0.1:${ port }`, '-t', wordpressDir, routerPath ],
		{
			cwd: wordpressDir,
			env: phpEnv,
			detached: Number.parseInt( workers || '1', 10 ) > 1,
		}
	);
}

function startFrankenPhp( handle, wordpressDir, port, appDir ) {
	const frankenBin = resolveExecutable(
		'CORTEXT_FRANKENPHP_BIN',
		path.join( appDir, 'runtime/bin/frankenphp' ),
		'frankenphp',
		'Download the FrankenPHP macOS binary into apps/desktop/runtime/bin/frankenphp.'
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
				CORTEXT_PORT: String( port ),
				CORTEXT_WORDPRESS_ROOT: wordpressDir,
				CORTEXT_CADDY_STORAGE: path.join( handle.stateDir, 'caddy' ),
				CORTEXT_FRANKEN_WORKERS:
					process.env.CORTEXT_FRANKEN_WORKERS || '1',
			},
		}
	);
}

function writePhpFpmConfig( runtimeStateDir, wordpressDir ) {
	fs.mkdirSync( runtimeStateDir, { recursive: true } );
	const socketDir = fs.mkdtempSync( path.join( os.tmpdir(), 'cortext-fpm-' ) );
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
			'php_value[opcache.enable] = 1',
			'php_value[opcache.validate_timestamps] = 0',
			'',
		].join( '\n' )
	);

	return { configPath, socketDir, socketPath };
}

function startPhpFpmCaddy( handle, wordpressDir, port, appDir, runtimeStateDir ) {
	const phpFpmBin = resolveExecutable(
		'CORTEXT_PHP_FPM_BIN',
		path.join( appDir, 'runtime/bin/php-fpm' ),
		'php-fpm',
		'Install php-fpm or bundle apps/desktop/runtime/bin/php-fpm.'
	);
	const caddyBin = resolveExecutable(
		'CORTEXT_CADDY_BIN',
		path.join( appDir, 'runtime/bin/caddy' ),
		'caddy',
		'Download Caddy into apps/desktop/runtime/bin/caddy.'
	);
	const configPath = path.join( appDir, 'runtime/Caddyfile.php-fpm' );
	if ( ! fs.existsSync( configPath ) ) {
		throw new Error( `PHP-FPM Caddyfile not found at ${ configPath }.` );
	}

	const fpm = writePhpFpmConfig( runtimeStateDir, wordpressDir );
	handle.cleanupPaths.push( fpm.socketDir );
	console.log(
		`[cortext-desktop] starting php-fpm + Caddy (127.0.0.1:${ port }) against ${ wordpressDir }`
	);
	addProcess(
		handle,
		'php-fpm',
		phpFpmBin,
		[ '-F', '-O', '-y', fpm.configPath ],
		{ cwd: wordpressDir, env: process.env }
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
				CORTEXT_PORT: String( port ),
				CORTEXT_WORDPRESS_ROOT: wordpressDir,
				CORTEXT_PHP_FPM_SOCKET: fpm.socketPath,
				CORTEXT_CADDY_STORAGE: path.join( handle.stateDir, 'caddy' ),
			},
		}
	);
}

function startRuntime( {
	appDir,
	wordpressDir,
	port = DEFAULT_PORT,
	runtime = process.env.CORTEXT_RUNTIME,
	runtimeStateDir,
	onUnexpectedExit,
} ) {
	const normalized = normalizeRuntime( runtime );
	const handle = {
		runtime: normalized,
		processes: [],
		cleanupPaths: [],
		stopping: false,
		onUnexpectedExit,
	};
	const stateDir =
		runtimeStateDir ||
		fs.mkdtempSync( path.join( os.tmpdir(), 'cortext-desktop-runtime-' ) );
	handle.stateDir = stateDir;

	if ( normalized === 'php' ) {
		startPhpCli( handle, wordpressDir, port, appDir );
	} else if ( normalized === 'franken' ) {
		startFrankenPhp( handle, wordpressDir, port, appDir );
	} else if ( normalized === 'php-fpm' ) {
		startPhpFpmCaddy( handle, wordpressDir, port, appDir, stateDir );
	}

	handle.ready = waitForHttpReady( handle, port );
	return handle;
}

function stopRuntime( handle ) {
	if ( ! handle ) {
		return;
	}
	handle.stopping = true;
	for ( const { child, killProcessGroup } of [ ...handle.processes ].reverse() ) {
		if ( child && child.exitCode === null && child.signalCode === null ) {
			try {
				if ( killProcessGroup && child.pid ) {
					process.kill( -child.pid, 'SIGTERM' );
				} else {
					child.kill( 'SIGTERM' );
				}
			} catch {}
			const timer = setTimeout( () => {
				if ( child.exitCode === null && child.signalCode === null ) {
					try {
						if ( killProcessGroup && child.pid ) {
							process.kill( -child.pid, 'SIGKILL' );
						} else {
							child.kill( 'SIGKILL' );
						}
					} catch {}
				}
			}, 5000 );
			timer.unref?.();
		}
	}
	for ( const cleanupPath of handle.cleanupPaths || [] ) {
		fs.rmSync( cleanupPath, { recursive: true, force: true } );
	}
}

module.exports = {
	DEFAULT_PORT,
	normalizeRuntime,
	startRuntime,
	stopRuntime,
};
