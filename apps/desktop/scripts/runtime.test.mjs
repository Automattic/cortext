import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import runtimeHelpers from '../lib/runtime.js';

const {
	bundledRuntimeExecutable,
	childProcessOptions,
	findRuntimeExecutable,
	phpCliWorkerConfig,
	runWindowsTaskkill,
	stopRuntime,
	waitForProcessExit,
} = runtimeHelpers;

class FakeChild extends EventEmitter {
	constructor( pid = 1234 ) {
		super();
		this.pid = pid;
		this.exitCode = null;
		this.signalCode = null;
		this.killCalls = [];
	}

	kill( signal ) {
		this.killCalls.push( signal );
		return true;
	}

	exit( code = 0 ) {
		this.exitCode = code;
		this.emit( 'exit', code, null );
		this.emit( 'close', code, null );
	}
}

test( 'runtime lookup skips Windows batch wrappers', () => {
	const files = new Set(
		[ 'C:\\wrappers\\php.cmd', 'C:\\native\\php.exe' ].map( ( file ) =>
			file.toLowerCase()
		)
	);
	assert.equal(
		findRuntimeExecutable( 'php', {
			platform: 'win32',
			env: {
				PATH: 'C:\\wrappers;C:\\native',
				PATHEXT: '.CMD;.EXE',
			},
			isFile: ( candidate ) => files.has( candidate.toLowerCase() ),
		} ),
		'C:\\native\\php.EXE'
	);
} );

test( 'bundled PHP resolves to php.exe on Windows and php elsewhere', () => {
	assert.equal(
		bundledRuntimeExecutable( 'C:\\Cortext', 'php', 'win32' ),
		path.win32.join( 'C:\\Cortext', 'runtime/bin', 'php.exe' )
	);
	assert.equal(
		bundledRuntimeExecutable( '/Applications/Cortext', 'php', 'darwin' ),
		path.join( '/Applications/Cortext', 'runtime/bin', 'php' )
	);
} );

test( 'child process options hide the Windows console', () => {
	assert.deepEqual( childProcessOptions( { cwd: 'C:\\site' } ), {
		stdio: [ 'ignore', 'pipe', 'pipe' ],
		cwd: 'C:\\site',
		windowsHide: true,
	} );
} );

test( 'Windows ignores PHP CLI worker settings and does not detach', () => {
	assert.deepEqual(
		phpCliWorkerConfig(
			{
				CORTEXT_PHP_CLI_SERVER_WORKERS: '4',
				PHP_CLI_SERVER_WORKERS: '8',
			},
			'win32'
		),
		{
			workers: null,
			detached: false,
			ignoredWorkers: '4',
		}
	);
} );

test( 'POSIX keeps the configured PHP worker count and uses a process group', () => {
	assert.deepEqual(
		phpCliWorkerConfig( { PHP_CLI_SERVER_WORKERS: '3' }, 'darwin' ),
		{
			workers: '3',
			detached: true,
			ignoredWorkers: null,
		}
	);
} );

test( 'Windows stops processes without POSIX signals', async () => {
	const child = new FakeChild();
	const stopped = waitForProcessExit( child, {
		platform: 'win32',
		gracePeriodMs: 100,
		forcePeriodMs: 100,
	} );
	assert.deepEqual( child.killCalls, [ undefined ] );
	child.exit();
	await stopped;
} );

test( 'Windows uses taskkill for the process tree after graceful shutdown times out', async () => {
	const calls = [];
	const killer = new EventEmitter();
	killer.kill = () => {};
	const completed = runWindowsTaskkill( 4321, ( command, args, options ) => {
		calls.push( { command, args, options } );
		queueMicrotask( () => killer.emit( 'exit', 0 ) );
		return killer;
	} );

	assert.equal( await completed, true );
	assert.deepEqual( calls, [
		{
			command: 'taskkill',
			args: [ '/PID', '4321', '/T', '/F' ],
			options: {
				stdio: [ 'ignore', 'ignore', 'ignore' ],
				windowsHide: true,
			},
		},
	] );
} );

test( 'POSIX shutdown signals the process group with SIGTERM first', async () => {
	const child = new FakeChild();
	const signals = [];
	const stopped = waitForProcessExit( child, {
		killProcessGroup: true,
		gracePeriodMs: 100,
		forcePeriodMs: 100,
		sendSignal: ( target, killProcessGroup, signal ) => {
			signals.push( { target, killProcessGroup, signal } );
		},
	} );

	assert.deepEqual( signals, [
		{ target: child, killProcessGroup: true, signal: 'SIGTERM' },
	] );
	child.exit();
	await stopped;
} );

test( 'stopRuntime reuses its promise and cleans up after exit', async () => {
	const cleanupPath = fs.mkdtempSync(
		path.join( os.tmpdir(), 'cortext-runtime-stop-' )
	);
	const child = new FakeChild();
	const handle = {
		processes: [ { child, killProcessGroup: false } ],
		cleanupPaths: [ cleanupPath ],
		stopping: false,
	};

	const first = stopRuntime( handle );
	const second = stopRuntime( handle );
	assert.equal( first, second );
	assert.equal( handle.stopping, true );
	assert.equal( fs.existsSync( cleanupPath ), true );

	let settled = false;
	first.finally( () => {
		settled = true;
	} );
	await new Promise( ( resolve ) => setImmediate( resolve ) );
	assert.equal( settled, false );

	child.exit();
	await first;
	assert.equal( settled, true );
	assert.equal( fs.existsSync( cleanupPath ), false );
} );

test( 'a stop that times out still cleans up and stays marked as stopping', async () => {
	const cleanupPath = fs.mkdtempSync(
		path.join( os.tmpdir(), 'cortext-runtime-wedged-' )
	);
	const wedged = new FakeChild( 4321 );
	const crashes = [];
	const handle = {
		processes: [ { child: wedged, killProcessGroup: false } ],
		cleanupPaths: [ cleanupPath ],
		stopping: false,
		onUnexpectedExit: ( name ) => crashes.push( name ),
	};
	wedged.on( 'exit', () => {
		if ( ! handle.stopping ) {
			handle.onUnexpectedExit( 'php' );
		}
	} );

	await assert.rejects(
		stopRuntime( handle, { gracePeriodMs: 5, forcePeriodMs: 5 } ),
		/is still running after forced termination/
	);
	assert.equal( fs.existsSync( cleanupPath ), false );
	assert.equal( handle.stopping, true );

	// The kill was still on its way, so the exit that follows is not a crash.
	wedged.exit();
	assert.deepEqual( crashes, [] );
} );

test( 'waitForProcessExit sends SIGKILL, then rejects if the process stays alive', async () => {
	const child = new FakeChild( 5678 );
	const signals = [];
	await assert.rejects(
		waitForProcessExit( child, {
			gracePeriodMs: 5,
			forcePeriodMs: 5,
			sendSignal: ( target, killProcessGroup, signal ) => {
				signals.push( { target, killProcessGroup, signal } );
			},
		} ),
		/is still running after forced termination/
	);
	assert.deepEqual( signals, [
		{ target: child, killProcessGroup: false, signal: 'SIGTERM' },
		{ target: child, killProcessGroup: false, signal: 'SIGKILL' },
	] );
} );

test( 'Windows shutdown rejects when the process stays alive after taskkill', async () => {
	const child = new FakeChild( 5678 );
	const taskkillPids = [];
	await assert.rejects(
		waitForProcessExit( child, {
			platform: 'win32',
			gracePeriodMs: 5,
			forcePeriodMs: 5,
			runTaskkill: async ( pid ) => {
				taskkillPids.push( pid );
				return true;
			},
		} ),
		/is still running after forced termination/
	);
	assert.deepEqual( child.killCalls, [ undefined ] );
	assert.deepEqual( taskkillPids, [ 5678 ] );
} );
