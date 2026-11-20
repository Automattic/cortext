/**
 * Tests for `src/components/computeCascadeRoots.js`, which groups trashed or
 * archived documents under the document whose status change took them along.
 */

import computeCascadeRoots from '../../../src/components/computeCascadeRoots';

const ARCHIVE_MARKERS = [
	'_cortext_archived_by_parent',
	'_cortext_archived_by_collection',
];

function makeDocument( overrides = {} ) {
	return {
		id: 1,
		title: { raw: 'Finished', rendered: 'Finished' },
		meta: {},
		...overrides,
	};
}

it( 'collapses parent and collection cascades into one root', () => {
	const root = makeDocument();
	const child = makeDocument( {
		id: 2,
		meta: { _cortext_archived_by_parent: 1 },
	} );
	const row = makeDocument( {
		id: 3,
		crtxt_trait: [ 2 ],
		meta: { _cortext_archived_by_collection: 2 },
	} );

	const result = computeCascadeRoots( [ root, child, row ], ARCHIVE_MARKERS );

	expect( result.roots ).toEqual( [ root ] );
	expect( result.descendantCountById.get( 1 ) ).toEqual( { total: 2 } );
	expect( result.descendantsById.get( 1 ) ).toEqual(
		expect.arrayContaining( [ child, row ] )
	);
} );

it( 'promotes a document whose marker points at a missing document', () => {
	const orphan = makeDocument( {
		id: 8,
		meta: { _cortext_archived_by_parent: 99 },
	} );

	expect( computeCascadeRoots( [ orphan ], ARCHIVE_MARKERS ).roots ).toEqual(
		[ orphan ]
	);
} );
