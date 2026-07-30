import assert from 'node:assert/strict';
import test from 'node:test';

import executableHelpers from '../lib/executable.js';

const {
	DEFAULT_WINDOWS_PATHEXT,
	bundledRuntimeExecutable,
	envValue,
	findExecutable,
} = executableHelpers;

function windowsFiles( files ) {
	const normalized = new Set( files.map( ( file ) => file.toLowerCase() ) );
	return ( candidate ) => normalized.has( candidate.toLowerCase() );
}

test( 'Windows environment lookup is case-insensitive', () => {
	assert.equal( envValue( { Path: 'C:\\bin' }, 'PATH', 'win32' ), 'C:\\bin' );
	assert.equal( envValue( { pathext: '.EXE' }, 'PATHEXT', 'win32' ), '.EXE' );
} );

test( 'bundled runtime paths use .exe on Windows', () => {
	assert.equal(
		bundledRuntimeExecutable( 'C:\\Cortext', 'php', 'win32' ),
		'C:\\Cortext\\runtime\\bin\\php.exe'
	);
	assert.equal(
		bundledRuntimeExecutable( '/Applications/Cortext', 'php', 'darwin' ),
		'/Applications/Cortext/runtime/bin/php'
	);
} );

test( 'findExecutable searches quoted Windows PATH entries with PATHEXT', () => {
	const isFile = windowsFiles( [ 'C:\\Program Files\\PHP ñ\\php.EXE' ] );
	assert.equal(
		findExecutable( 'php', {
			platform: 'win32',
			env: {
				Path: '"C:\\Program Files\\PHP ñ";C:\\other',
				Pathext: '.EXE;.CMD',
			},
			cwd: 'C:\\workspace',
			isFile,
		} ),
		'C:\\Program Files\\PHP ñ\\php.EXE'
	);
} );

test( 'findExecutable uses custom PATHEXT entries', () => {
	const isFile = windowsFiles( [ 'C:\\tools\\runner.CMD' ] );
	assert.equal(
		findExecutable( 'runner', {
			platform: 'win32',
			env: { PATH: 'C:\\tools', PATHEXT: '.CMD;.EXE' },
			cwd: 'C:\\workspace',
			isFile,
		} ),
		'C:\\tools\\runner.CMD'
	);
} );

test( 'findExecutable skips .cmd files when only .com and .exe are allowed', () => {
	const isFile = windowsFiles( [
		'C:\\batch-only\\php.CMD',
		'C:\\native\\php.EXE',
	] );
	assert.equal(
		findExecutable( 'php', {
			platform: 'win32',
			env: {
				PATH: 'C:\\batch-only;C:\\native',
				PATHEXT: '.CMD;.EXE',
			},
			cwd: 'C:\\workspace',
			isFile,
			allowedWindowsExtensions: [ '.COM', '.EXE' ],
		} ),
		'C:\\native\\php.EXE'
	);
	assert.equal(
		findExecutable( 'C:\\batch-only\\php.cmd', {
			platform: 'win32',
			env: { PATHEXT: '.CMD;.EXE' },
			isFile,
			allowedWindowsExtensions: [ '.COM', '.EXE' ],
		} ),
		null
	);
} );

test( 'findExecutable uses the standard Windows extensions when PATHEXT is missing', () => {
	const isFile = windowsFiles( [ 'C:\\tools\\php.EXE' ] );
	assert.match( DEFAULT_WINDOWS_PATHEXT, /\.EXE/ );
	assert.equal(
		findExecutable( 'php', {
			platform: 'win32',
			env: { Path: 'C:\\tools' },
			cwd: 'C:\\workspace',
			isFile,
		} ),
		'C:\\tools\\php.EXE'
	);
} );

test( 'findExecutable accepts an explicit quoted Windows path', () => {
	const isFile = windowsFiles( [ 'C:\\PHP Runtime\\php.exe' ] );
	assert.equal(
		findExecutable( '"C:\\PHP Runtime\\php.exe"', {
			platform: 'win32',
			env: {},
			cwd: 'C:\\workspace',
			isFile,
		} ),
		'C:\\PHP Runtime\\php.exe'
	);
} );

test( 'findExecutable returns null when no PATH candidate exists', () => {
	assert.equal(
		findExecutable( 'php', {
			platform: 'win32',
			env: { Path: 'C:\\missing' },
			cwd: 'C:\\workspace',
			isFile: () => false,
		} ),
		null
	);
} );
