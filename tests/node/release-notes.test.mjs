import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { buildReleaseNotes } from '../../scripts/release-notes.mjs';

const baseOptions = {
	milestone: '0.2.0',
	version: '0.2.0',
	strict: false,
	full: false,
};

function pullRequest( number, title, labels, login = 'github-actions[bot]' ) {
	return {
		number,
		title,
		html_url: `https://github.com/Automattic/cortext/pull/${ number }`,
		labels: labels.map( ( name ) => ( { name } ) ),
		user: { login },
	};
}

describe( 'release notes', () => {
	it( 'groups public release notes by type and area', () => {
		const notes = buildReleaseNotes(
			[
				pullRequest(
					10,
					'feat: add relation field',
					[ 'type: enhancement', 'area: collections' ],
					'zed'
				),
				pullRequest(
					11,
					'fix: restore sidebar trash',
					[ 'type: bug', 'area: shell' ],
					'amy'
				),
				pullRequest(
					12,
					'docs: update release process',
					[ 'type: docs', 'area: publishing' ],
					'amy'
				),
			],
			{ ...baseOptions, strict: true }
		);

		assert.equal(
			notes,
			`# Cortext 0.2.0

## Enhancements

### Collections

- Add relation field. ([#10](https://github.com/Automattic/cortext/pull/10))

## Bug fixes

### Shell

- Restore sidebar trash. ([#11](https://github.com/Automattic/cortext/pull/11))

## Contributors

@amy @zed

`
		);
	} );

	it( 'puts entries without exactly one supported area under Other without failing strict mode', () => {
		const notes = buildReleaseNotes(
			[
				pullRequest( 20, 'feat: add unclassified change', [
					'type: enhancement',
				] ),
				pullRequest( 21, 'feat: handle unknown area', [
					'type: enhancement',
					'area: mobile',
				] ),
				pullRequest( 22, 'feat: handle duplicate areas', [
					'type: enhancement',
					'area: canvas',
					'area: shell',
				] ),
				pullRequest( 23, 'feat: handle mixed known and unknown areas', [
					'type: enhancement',
					'area: collections',
					'area: mobile',
				] ),
			],
			{ ...baseOptions, strict: true }
		);

		assert.equal(
			notes,
			`# Cortext 0.2.0

## Enhancements

### Other

- Add unclassified change. ([#20](https://github.com/Automattic/cortext/pull/20))
- Handle unknown area. ([#21](https://github.com/Automattic/cortext/pull/21))
- Handle duplicate areas. ([#22](https://github.com/Automattic/cortext/pull/22))
- Handle mixed known and unknown areas. ([#23](https://github.com/Automattic/cortext/pull/23))

`
		);
	} );

	it( 'groups full release notes by type and area', () => {
		const notes = buildReleaseNotes(
			[
				pullRequest( 30, 'docs: clarify publishing setup', [
					'type: docs',
					'area: publishing',
				] ),
				pullRequest( 31, 'build: update desktop packaging', [
					'type: tooling',
					'area: desktop',
				] ),
				pullRequest( 32, 'internal: speed up perf fixtures', [
					'type: code quality',
					'area: performance',
				] ),
			],
			{ ...baseOptions, full: true, strict: true }
		);

		assert.match( notes, /## Documentation\n\n### Publishing/ );
		assert.match( notes, /## Tooling\n\n### Desktop/ );
		assert.match( notes, /## Code quality\n\n### Performance/ );
		assert.doesNotMatch( notes, /No public changelog entries/ );
	} );

	it( 'keeps strict mode focused on type labels', () => {
		assert.throws(
			() =>
				buildReleaseNotes(
					[
						pullRequest( 40, 'feat: miss type', [ 'area: shell' ] ),
						pullRequest( 41, 'feat: duplicate type', [
							'type: enhancement',
							'type: bug',
							'area: shell',
						] ),
					],
					{ ...baseOptions, strict: true }
				),
			( error ) => {
				assert.match(
					error.message,
					/#40 needs exactly one type:\* label; found none\./
				);
				assert.match(
					error.message,
					/#41 needs exactly one type:\* label; found type: enhancement, type: bug\./
				);
				return true;
			}
		);
	} );
} );
