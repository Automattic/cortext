#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve( dirname( fileURLToPath( import.meta.url ) ), '..' );
const wpEnv = resolve( root, 'node_modules', '.bin', 'wp-env' );

const args = process.argv.slice( 2 );
const wpEnvArgs = [];
const seedArgs = [];

for ( let i = 0; i < args.length; i++ ) {
	const arg = args[ i ];
	if ( arg.startsWith( '--config=' ) ) {
		wpEnvArgs.push( '--config', arg.slice( '--config='.length ) );
		continue;
	}
	if ( arg === '--config' ) {
		const value = args[ i + 1 ];
		if ( ! value ) {
			console.error( 'Missing value for --config.' );
			process.exit( 1 );
		}
		wpEnvArgs.push( '--config', value );
		i++;
		continue;
	}
	seedArgs.push( arg );
}

const result = spawnSync(
	wpEnv,
	[ ...wpEnvArgs, 'run', 'cli', 'wp', 'cortext', 'seed', ...seedArgs ],
	{
		cwd: root,
		stdio: 'inherit',
	}
);

if ( result.error ) {
	console.error( result.error.message );
	process.exit( 1 );
}

process.exit( result.status ?? 1 );
