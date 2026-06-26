/**
 * Unit tests for the pure query builder in `src/hooks/useRevisions.js`.
 *
 * The hooks themselves lean on `@wordpress/data` + the private editor store, so
 * the WordPress modules are mocked to keep `revisionQuery` importable in
 * isolation. The query identity is load-bearing: `getRevisions` resolution and
 * `invalidateResolution` deep-match on these args, so the shape must stay
 * stable.
 */
jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );
jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	store: 'core',
} ) );
jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useSelect: jest.fn(),
	useDispatch: jest.fn( () => ( {} ) ),
} ) );
jest.mock( '@wordpress/editor', () => ( {
	__esModule: true,
	store: 'editor',
} ) );
jest.mock( '@wordpress/notices', () => ( {
	__esModule: true,
	store: 'notices',
} ) );
jest.mock( '@wordpress/i18n', () => ( {
	__esModule: true,
	__: ( text ) => text,
} ) );
jest.mock( '../../../src/lock-unlock', () => ( {
	__esModule: true,
	unlock: ( value ) => value,
} ) );

import { revisionQuery } from '../../../src/hooks/useRevisions';

describe( 'revisionQuery', () => {
	it( 'builds a stable edit-context query ordered newest first', () => {
		const query = revisionQuery();

		expect( query.per_page ).toBe( -1 );
		expect( query.context ).toBe( 'edit' );
		expect( query.orderby ).toBe( 'date' );
		expect( query.order ).toBe( 'desc' );
	} );

	it( 'requests the fields the history list and property diff need', () => {
		const fields = revisionQuery()._fields.split( ',' );

		expect( fields ).toEqual(
			expect.arrayContaining( [
				'id',
				'date',
				'modified',
				'author',
				'meta',
				'title.raw',
				'excerpt.raw',
				'content.raw',
			] )
		);
	} );

	it( 'adds the entity revision key once and honors the order argument', () => {
		const idFields = revisionQuery( 'id' )._fields.split( ',' );
		expect( idFields.filter( ( field ) => field === 'id' ) ).toHaveLength(
			1
		);

		const customFields = revisionQuery( 'custom_key' )._fields.split( ',' );
		expect( customFields ).toContain( 'custom_key' );

		expect( revisionQuery( 'id', 'asc' ).order ).toBe( 'asc' );
	} );
} );
