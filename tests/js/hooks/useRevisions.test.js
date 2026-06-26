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

import {
	editorRevisionQuery,
	recentRevisionQuery,
	revisionFeaturedMedia,
	revisionInvalidationQueries,
	revisionMetaValue,
	revisionQuery,
} from '../../../src/hooks/useRevisions';

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
				'featured_media',
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

describe( 'revision cache invalidation queries', () => {
	it( 'includes the native editor query for the selected revision', () => {
		const query = editorRevisionQuery( 'custom_key' );

		expect( query ).toEqual( {
			per_page: -1,
			context: 'edit',
			_fields:
				'id,date,modified,author,meta,title.raw,excerpt.raw,content.raw,custom_key',
		} );
	} );

	it( 'includes the native ascending query for the previous revision', () => {
		expect( editorRevisionQuery( 'id', 'asc' ) ).toMatchObject( {
			per_page: -1,
			context: 'edit',
			orderby: 'date',
			order: 'asc',
		} );
	} );

	it( 'includes the native recent-revisions panel query', () => {
		expect( recentRevisionQuery( 'custom_key' ) ).toEqual( {
			per_page: 3,
			orderby: 'date',
			order: 'desc',
			_fields: 'custom_key,date,author',
		} );
	} );

	it( 'collects every query that should be stale after restoring', () => {
		expect( revisionInvalidationQueries( 'id' ) ).toEqual( [
			revisionQuery( 'id', 'desc' ),
			revisionQuery( 'id', 'asc' ),
			editorRevisionQuery( 'id' ),
			editorRevisionQuery( 'id', 'asc' ),
			recentRevisionQuery( 'id' ),
		] );
	} );
} );

describe( 'revision identity helpers', () => {
	it( 'reads scalar and array revision meta values', () => {
		expect(
			revisionMetaValue(
				{ meta: { cortext_document_icon: '{"type":"emoji"}' } },
				'cortext_document_icon'
			)
		).toBe( '{"type":"emoji"}' );

		expect(
			revisionMetaValue(
				{ meta: { cortext_document_icon: [ 'first', 'second' ] } },
				'cortext_document_icon'
			)
		).toBe( 'first' );
	} );

	it( 'falls back when revision meta is missing', () => {
		expect( revisionMetaValue( { meta: {} }, 'missing', 'fallback' ) ).toBe(
			'fallback'
		);
	} );

	it( 'uses featured_media before the legacy thumbnail meta key', () => {
		expect(
			revisionFeaturedMedia( {
				featured_media: 45,
				meta: { _thumbnail_id: '22' },
			} )
		).toBe( 45 );
		expect(
			revisionFeaturedMedia( { meta: { _thumbnail_id: '22' } } )
		).toBe( 22 );
	} );
} );
