import assert from 'node:assert/strict';
import test from 'node:test';

import { snapshotSeedCommands, splitArguments } from './seed-commands.mjs';

test( 'splitArguments separates unquoted arguments at whitespace', () => {
	assert.deepEqual( splitArguments( 'plugin activate cortext' ), [
		'plugin',
		'activate',
		'cortext',
	] );
	assert.deepEqual( splitArguments( '   spaced   out  ' ), [
		'spaced',
		'out',
	] );
	assert.deepEqual( splitArguments( '' ), [] );
} );

test( 'splitArguments keeps quoted text in one argument', () => {
	assert.deepEqual(
		splitArguments( 'post create --post_title="Hello world"' ),
		[ 'post', 'create', '--post_title=Hello world' ]
	);
	assert.deepEqual( splitArguments( "eval 'echo 1;'" ), [
		'eval',
		'echo 1;',
	] );
	// Empty quotes produce an empty argument.
	assert.deepEqual( splitArguments( 'option update blogname ""' ), [
		'option',
		'update',
		'blogname',
		'',
	] );
} );

test( 'splitArguments rejects unclosed quotes', () => {
	assert.throws(
		() => splitArguments( 'post create --post_title="Hello' ),
		/Unclosed double quote/
	);
} );

test( 'snapshotSeedCommands uses cortext seed by default', () => {
	assert.deepEqual( snapshotSeedCommands( {} ), [ [ 'cortext', 'seed' ] ] );
} );

test( 'snapshotSeedCommands appends arguments to the default command', () => {
	assert.deepEqual(
		snapshotSeedCommands( { CORTEXT_DESKTOP_SEED_ARGS: '--full' } ),
		[ [ 'cortext', 'seed', '--full' ] ]
	);
} );

test( 'snapshotSeedCommands runs extra commands after the default', () => {
	assert.deepEqual(
		snapshotSeedCommands( {
			CORTEXT_DESKTOP_EXTRA_SEED_COMMANDS:
				'plugin activate cortext\n\noption update blogname "My site"',
		} ),
		[
			[ 'cortext', 'seed' ],
			[ 'plugin', 'activate', 'cortext' ],
			[ 'option', 'update', 'blogname', 'My site' ],
		]
	);
} );

test( 'snapshotSeedCommands uses the override instead of the default', () => {
	assert.deepEqual(
		snapshotSeedCommands( {
			CORTEXT_DESKTOP_SEED_COMMANDS: 'cortext seed --minimal',
			CORTEXT_DESKTOP_SEED_ARGS: '--full',
		} ),
		[ [ 'cortext', 'seed', '--minimal' ] ]
	);
} );
