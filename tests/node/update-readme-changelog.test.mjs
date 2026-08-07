import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
	buildWordPressChangelog,
	upsertReadmeChangelog,
} from '../../scripts/update-readme-changelog.mjs';

const releaseNotes = `# Cortext 0.2.0

## Enhancements

### Canvas

- Add inline document mentions. ([#376](https://github.com/Automattic/cortext/pull/376))

### Collections

- Add formula fields to collections. ([#274](https://github.com/Automattic/cortext/pull/274))

## Contributors

@priethor

## Installing the macOS app

Move Cortext to Applications before opening it.
`;

describe( 'update WordPress readme changelog', () => {
	it( 'converts public GitHub release notes to WordPress readme markup', () => {
		assert.equal(
			buildWordPressChangelog( '0.2.0', releaseNotes ),
			`= 0.2.0 =
Enhancements:

**Canvas**

* Add inline document mentions. ([#376](https://github.com/Automattic/cortext/pull/376))

**Collections**

* Add formula fields to collections. ([#274](https://github.com/Automattic/cortext/pull/274))
`
		);
	} );

	it( 'inserts a new version at the top of the changelog', () => {
		const readme = `=== Cortext ===

== Changelog ==

= 0.1.1 =
Previous release.
`;

		const updated = upsertReadmeChangelog( readme, '0.2.0', releaseNotes );

		assert.match(
			updated,
			/== Changelog ==\n\n= 0\.2\.0 =[\s\S]*\n= 0\.1\.1 =/
		);
	} );

	it( 'replaces an existing version idempotently', () => {
		const stale = `=== Cortext ===

== Changelog ==

= 0.2.0 =
Stale notes.

= 0.1.1 =
Previous release.
`;

		const updated = upsertReadmeChangelog( stale, '0.2.0', releaseNotes );
		assert.doesNotMatch( updated, /Stale notes/ );
		assert.equal(
			upsertReadmeChangelog( updated, '0.2.0', releaseNotes ),
			updated
		);
	} );

	it( 'rejects a readme without a changelog section', () => {
		assert.throws(
			() =>
				upsertReadmeChangelog(
					'=== Cortext ===\n',
					'0.2.0',
					releaseNotes
				),
			/missing the "== Changelog ==" section/
		);
	} );
} );
