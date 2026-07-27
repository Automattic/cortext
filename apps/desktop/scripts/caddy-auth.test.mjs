import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';

const CONFIGS = [
	{
		name: 'PHP-FPM',
		path: new URL( '../runtime/Caddyfile.php-fpm', import.meta.url ),
		upstreamDirective: 'php_fastcgi ',
	},
	{
		name: 'FrankenPHP',
		path: new URL( '../runtime/Caddyfile.frankenphp', import.meta.url ),
		upstreamDirective: 'php_server {',
	},
];

for ( const config of CONFIGS ) {
	test( `${ config.name } authenticates before removing the private header`, () => {
		const caddyfile = fs.readFileSync( config.path, 'utf8' );
		const authenticateAt = caddyfile.indexOf(
			'respond @unauthorized "Forbidden" 403'
		);
		const removeHeaderAt = caddyfile.indexOf(
			'request_header -X-Cortext-Desktop-Token'
		);
		const upstreamAt = caddyfile.indexOf( config.upstreamDirective );

		assert.notEqual( authenticateAt, -1 );
		assert.notEqual( removeHeaderAt, -1 );
		assert.notEqual( upstreamAt, -1 );
		assert.ok( authenticateAt < removeHeaderAt );
		assert.ok( removeHeaderAt < upstreamAt );
	} );

	test( `${ config.name } filters the private header from error logs`, () => {
		const caddyfile = fs.readFileSync( config.path, 'utf8' );

		assert.match(
			caddyfile,
			/log default \{[\s\S]*format filter \{[\s\S]*request>headers>X-Cortext-Desktop-Token delete/
		);
	} );
}
