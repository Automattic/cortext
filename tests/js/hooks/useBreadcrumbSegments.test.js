/**
 * Tests for `src/hooks/useBreadcrumbSegments.js`: the breadcrumb chain and the
 * collections offered for multi-collection items. core-data, data, and the
 * router are mocked so each case controls the records, the URL and navigation.
 */

import { renderHook } from '@testing-library/react';

jest.mock( '@wordpress/core-data', () => ( {
	store: 'core',
	useEntityRecord: jest.fn(),
	useEntityRecords: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => ( {
	useSelect: jest.fn(),
} ) );

const mockNavigate = jest.fn();
let mockSearch = {};
jest.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => mockNavigate,
	useSearch: () => mockSearch,
} ) );

import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useSelect } from '@wordpress/data';
import useBreadcrumbSegments from '../../../src/hooks/useBreadcrumbSegments';

const page = { id: 4, parent: 0, title: { raw: 'Workspace' } };
const collection = { id: 10, parent: 4, title: { raw: 'Invoices' } };
const row = { id: 50, parent: 0, crtxt_trait: [ 7 ], title: { raw: 'INV-1' } };
const term = { id: 7, slug: '10' };

const projects = { id: 1, parent: 0, title: { raw: 'Projects' } };
const people = { id: 2, parent: 0, title: { raw: 'People' } };

let lists;
let byId;
const getEntityRecord = jest.fn( ( kind, name, id ) => byId[ kind ]?.[ id ] );

function render( document ) {
	useEntityRecord.mockReturnValue( { record: document } );
	return renderHook( () => useBreadcrumbSegments( document?.id ?? null ) )
		.result.current;
}

function labelsOf( items ) {
	return items.map( ( item ) => item.label );
}

beforeEach( () => {
	jest.clearAllMocks();
	mockSearch = {};
	lists = { pages: [], collections: [], terms: [] };
	byId = {
		postType: { 4: page, 10: collection, 50: row },
		taxonomy: { 7: term },
	};
	useEntityRecords.mockImplementation( ( kind, name, query ) => {
		if ( kind === 'taxonomy' ) {
			return { records: lists.terms };
		}
		return {
			records: query.cortext_collections
				? lists.collections
				: lists.pages,
		};
	} );
	useSelect.mockImplementation( ( mapSelect ) =>
		mapSelect( () => ( { getEntityRecord } ) )
	);
} );

describe( 'useBreadcrumbSegments', () => {
	it( 'builds the chain from the cached lists without fetching by id', () => {
		lists = {
			pages: [ page ],
			collections: [ collection ],
			terms: [ term ],
		};

		expect( labelsOf( render( row ).segments ) ).toEqual( [
			'Workspace',
			'Invoices',
			'INV-1',
		] );
		expect( getEntityRecord ).not.toHaveBeenCalled();
	} );

	it( 'resolves ancestors missing from the cached lists by id', () => {
		expect( labelsOf( render( row ).segments ) ).toEqual( [
			'Workspace',
			'Invoices',
			'INV-1',
		] );
	} );

	it( 'reads fallback terms in view context, like the terms list', () => {
		render( row );

		expect( getEntityRecord ).toHaveBeenCalledWith(
			'taxonomy',
			'crtxt_trait',
			7,
			{ context: 'view' }
		);
	} );

	it( 'stops at the last ancestor that has loaded', () => {
		delete byId.postType[ 10 ];

		expect( labelsOf( render( row ).segments ) ).toEqual( [ 'INV-1' ] );
	} );

	describe( 'with traits', () => {
		beforeEach( () => {
			// Mirror term slug is the collection's post id.
			lists = {
				pages: [],
				collections: [ projects, people ],
				terms: [
					{ id: 11, slug: '1' },
					{ id: 22, slug: '2' },
				],
			};
		} );

		it( 'returns the collection as the parent for a single-collection row and offers no others', () => {
			const result = render( {
				id: 100,
				title: { raw: 'Ada' },
				crtxt_trait: [ 11 ],
				parent: 0,
			} );

			expect( labelsOf( result.segments ) ).toEqual( [
				'Projects',
				'Ada',
			] );
			expect( result.collections ).toEqual( [] );
		} );

		it( 'skips an unresolved membership when choosing the parent', () => {
			lists.terms = [
				{ id: 99, slug: '999' },
				{ id: 22, slug: '2' },
			];

			const result = render( {
				id: 100,
				title: { raw: 'Ada' },
				crtxt_trait: [ 99, 22 ],
				parent: 0,
			} );

			expect( labelsOf( result.segments ) ).toEqual( [
				'People',
				'Ada',
			] );
			expect( result.collections ).toEqual( [] );
		} );

		it( 'skips a trashed collection fetched by id', () => {
			lists.terms.push( { id: 33, slug: '3' } );
			byId.postType[ 3 ] = {
				id: 3,
				parent: 0,
				status: 'trash',
				title: { raw: 'Archive' },
			};

			const result = render( {
				id: 100,
				title: { raw: 'Ada' },
				crtxt_trait: [ 33, 22 ],
				parent: 0,
			} );

			expect( labelsOf( result.segments ) ).toEqual( [
				'People',
				'Ada',
			] );
			expect( result.collections ).toEqual( [] );
		} );

		it( 'skips an archived collection while another one is live', () => {
			lists.terms.push( { id: 55, slug: '5' } );
			byId.postType[ 5 ] = {
				id: 5,
				parent: 0,
				status: 'crtxt_archived',
				title: { raw: 'Old projects' },
			};

			const result = render( {
				id: 100,
				title: { raw: 'Ada' },
				crtxt_trait: [ 55, 11, 22 ],
				parent: 0,
			} );

			expect( labelsOf( result.segments ) ).toEqual( [ 'Ada' ] );
			expect( labelsOf( result.collections ) ).toEqual( [
				'People',
				'Projects',
			] );
		} );

		it( 'keeps the collection of a row retired together with it', () => {
			lists.terms.push( { id: 33, slug: '3' } );
			byId.postType[ 3 ] = {
				id: 3,
				parent: 0,
				status: 'trash',
				title: { raw: 'Old tasks' },
			};

			const result = render( {
				id: 100,
				title: { raw: 'Ada' },
				crtxt_trait: [ 33 ],
				parent: 0,
			} );

			expect( labelsOf( result.segments ) ).toEqual( [
				'Old tasks',
				'Ada',
			] );
			expect( result.collections ).toEqual( [] );
		} );

		const ada = {
			id: 100,
			title: { raw: 'Ada' },
			crtxt_trait: [ 11, 22 ],
			parent: 0,
		};

		it( 'shows the item alone and offers its collections when it was opened from none of them', () => {
			const result = render( ada );

			// No arbitrary collection is chosen as the parent.
			expect( labelsOf( result.segments ) ).toEqual( [ 'Ada' ] );
			expect( labelsOf( result.collections ) ).toEqual( [
				'People',
				'Projects',
			] );
			expect(
				result.collections.some( ( item ) => item.isCurrent )
			).toBe( false );
		} );

		it( 'climbs into the collection the item was opened from', () => {
			mockSearch = { collection: '2', collectionRow: '100' };

			const result = render( ada );

			expect( labelsOf( result.segments ) ).toEqual( [
				'People',
				'Ada',
			] );
			expect( result.segments[ 0 ].isContextCollection ).toBe( true );
			expect(
				result.collections.find( ( item ) => item.isCurrent )?.label
			).toBe( 'People' );
		} );

		it( 'ignores a hint for a collection the item is not in', () => {
			mockSearch = { collection: '999', collectionRow: '100' };

			expect( labelsOf( render( ada ).segments ) ).toEqual( [ 'Ada' ] );
		} );

		it( 'ignores a hint left by another item', () => {
			mockSearch = { collection: '2', collectionRow: '101' };

			expect( labelsOf( render( ada ).segments ) ).toEqual( [ 'Ada' ] );
		} );

		it( 'reopens the item from the collection picked in the menu', () => {
			const result = render( ada );

			result.collections
				.find( ( item ) => item.label === 'Projects' )
				.onClick();

			const { search } = mockNavigate.mock.calls[ 0 ][ 0 ];
			expect( search( { view: 'x' } ) ).toEqual( {
				view: 'x',
				collection: 1,
				collectionRow: 100,
			} );
		} );

		it( 'returns no segments or collections without a document', () => {
			const result = render( null );

			expect( result.segments ).toEqual( [] );
			expect( result.collections ).toEqual( [] );
		} );
	} );
} );
