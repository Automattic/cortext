import { act, renderHook, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';

import useSidebarTree, {
	buildSidebarTreeBranchPath,
	ROOT_PARENT_ID,
	SIDEBAR_TREE_PREFERENCES_PATH,
} from '../../../../src/components/sidebar/useSidebarTree';
import { SIDEBAR_TREE_CHANGED_EVENT } from '../../../../src/hooks/sidebarTreeInvalidation';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

function makeRecord( id, parent = 0, title = `Page ${ id }` ) {
	return {
		id,
		type: 'crtxt_document',
		parent,
		menu_order: id,
		status: 'private',
		slug: `page-${ id }`,
		title: { rendered: title, raw: title },
		meta: { cortext_document_icon: '' },
		cortext_defines_trait: false,
		cortext_has_tree_children: false,
		crtxt_trait: [],
	};
}

function responsePage( records, total = records.length, totalPages = 1 ) {
	return {
		headers: {
			get: ( name ) => {
				if ( name === 'X-WP-Total' ) {
					return String( total );
				}
				if ( name === 'X-WP-TotalPages' ) {
					return String( totalPages );
				}
				return null;
			},
		},
		json: jest.fn().mockResolvedValue( records ),
	};
}

function parsedPath( path ) {
	return new URL( path, 'https://example.test' );
}

describe( 'buildSidebarTreeBranchPath', () => {
	it( 'builds a request for one parent branch', () => {
		const url = parsedPath( buildSidebarTreeBranchPath( 12, 3 ) );

		expect( url.pathname ).toBe( '/wp/v2/crtxt_documents' );
		expect( url.searchParams.get( 'context' ) ).toBe( 'edit' );
		expect( url.searchParams.get( 'parent' ) ).toBe( '12' );
		expect( url.searchParams.get( 'page' ) ).toBe( '3' );
		expect( url.searchParams.get( 'per_page' ) ).toBe( '20' );
		expect( url.searchParams.get( 'cortext_no_trait' ) ).toBe( '1' );
		expect( url.searchParams.get( 'cortext_tree_order' ) ).toBe( '1' );
		expect( url.searchParams.get( 'orderby' ) ).toBe( 'menu_order' );
		expect( url.searchParams.get( '_fields' ) ).toContain(
			'cortext_defines_trait'
		);
		expect( url.searchParams.get( '_fields' ) ).toContain(
			'cortext_has_tree_children'
		);
	} );
} );

describe( 'useSidebarTree', () => {
	beforeEach( () => {
		apiFetch.mockReset();
	} );

	function mockTreeRequests( {
		preferences = [],
		branches = {},
		records = {},
	} = {} ) {
		apiFetch.mockImplementation( ( request ) => {
			const { path, method } = request;
			if ( path === SIDEBAR_TREE_PREFERENCES_PATH ) {
				if ( method === 'PUT' ) {
					return Promise.resolve( {
						expanded: request.data?.expanded ?? [],
					} );
				}
				return Promise.resolve( { expanded: preferences } );
			}

			const url = parsedPath( path );
			const recordMatch = url.pathname.match(
				/^\/wp\/v2\/crtxt_documents\/(\d+)$/
			);
			if ( recordMatch ) {
				return Promise.resolve( records[ Number( recordMatch[ 1 ] ) ] );
			}

			const parent = Number( url.searchParams.get( 'parent' ) ?? 0 );
			const page = Number( url.searchParams.get( 'page' ) ?? 1 );
			const branch = branches[ `${ parent }:${ page }` ] ?? {
				records: [],
				total: 0,
				totalPages: 0,
			};
			return Promise.resolve(
				responsePage( branch.records, branch.total, branch.totalPages )
			);
		} );
	}

	it( 'loads the root branch, then appends the next page', async () => {
		mockTreeRequests( {
			branches: {
				'0:1': {
					records: [ makeRecord( 1 ) ],
					total: 2,
					totalPages: 2,
				},
				'0:2': {
					records: [ makeRecord( 2 ) ],
					total: 2,
					totalPages: 2,
				},
			},
		} );

		const { result } = renderHook( () =>
			useSidebarTree( {
				selectedId: null,
				selectedCollectionId: null,
			} )
		);

		await waitFor( () => expect( result.current.tree ).toHaveLength( 1 ) );

		expect( result.current.rootBranch.totalPages ).toBe( 2 );

		await act( async () => {
			await result.current.loadMore( ROOT_PARENT_ID );
		} );

		await waitFor( () =>
			expect(
				result.current.tree.map( ( node ) => node.page.id )
			).toEqual( [ 1, 2 ] )
		);
	} );

	it( 'loads children and saves the branch as expanded', async () => {
		mockTreeRequests( {
			branches: {
				'0:1': {
					records: [ makeRecord( 1 ) ],
					total: 1,
					totalPages: 1,
				},
				'1:1': {
					records: [ makeRecord( 2, 1, 'Child' ) ],
					total: 1,
					totalPages: 1,
				},
			},
		} );

		const { result } = renderHook( () =>
			useSidebarTree( {
				selectedId: null,
				selectedCollectionId: null,
			} )
		);

		await waitFor( () => expect( result.current.tree ).toHaveLength( 1 ) );

		await act( async () => {
			result.current.toggleExpand( 1 );
		} );

		await waitFor( () =>
			expect( result.current.tree[ 0 ].children[ 0 ].page.id ).toBe( 2 )
		);

		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: SIDEBAR_TREE_PREFERENCES_PATH,
				method: 'PUT',
				data: { expanded: [ 1 ] },
			} )
		);
	} );

	it( 'reopens branches saved in user preferences', async () => {
		mockTreeRequests( {
			preferences: [ 1 ],
			records: {
				1: makeRecord( 1 ),
			},
			branches: {
				'0:1': {
					records: [ makeRecord( 1 ) ],
					total: 1,
					totalPages: 1,
				},
				'1:1': {
					records: [ makeRecord( 2, 1, 'Child' ) ],
					total: 1,
					totalPages: 1,
				},
			},
		} );

		const { result } = renderHook( () =>
			useSidebarTree( {
				selectedId: null,
				selectedCollectionId: null,
			} )
		);

		await waitFor( () =>
			expect( result.current.tree[ 0 ].children[ 0 ].page.id ).toBe( 2 )
		);

		expect( result.current.expandedIds.has( 1 ) ).toBe( true );
	} );

	it( 'removes saved descendants when a parent branch is collapsed', async () => {
		mockTreeRequests( {
			preferences: [ 1, 2 ],
			records: {
				1: makeRecord( 1 ),
				2: makeRecord( 2, 1, 'Child' ),
			},
			branches: {
				'0:1': {
					records: [ makeRecord( 1 ) ],
					total: 1,
					totalPages: 1,
				},
				'1:1': {
					records: [ makeRecord( 2, 1, 'Child' ) ],
					total: 1,
					totalPages: 1,
				},
				'2:1': {
					records: [ makeRecord( 3, 2, 'Grandchild' ) ],
					total: 1,
					totalPages: 1,
				},
			},
		} );

		const { result } = renderHook( () =>
			useSidebarTree( {
				selectedId: null,
				selectedCollectionId: null,
			} )
		);

		await waitFor( () => {
			expect( result.current.expandedIds.has( 1 ) ).toBe( true );
			expect( result.current.expandedIds.has( 2 ) ).toBe( true );
		} );

		await waitFor( () =>
			expect( result.current.tree[ 0 ].children[ 0 ].page.id ).toBe( 2 )
		);

		await act( async () => {
			result.current.toggleExpand( 1 );
		} );

		expect( result.current.expandedIds.has( 1 ) ).toBe( false );
		expect( result.current.expandedIds.has( 2 ) ).toBe( false );
		expect( apiFetch ).toHaveBeenCalledWith(
			expect.objectContaining( {
				path: SIDEBAR_TREE_PREFERENCES_PATH,
				method: 'PUT',
				data: { expanded: [] },
			} )
		);
	} );

	it( 'reveals a restored active document after refreshing its branch', async () => {
		mockTreeRequests( {
			records: {
				2: makeRecord( 2 ),
			},
			branches: {
				'0:1': {
					records: [ makeRecord( 1 ) ],
					total: 2,
					totalPages: 2,
				},
				'0:2': {
					records: [ makeRecord( 2 ) ],
					total: 2,
					totalPages: 2,
				},
			},
		} );

		const { result } = renderHook( () =>
			useSidebarTree( {
				selectedId: null,
				selectedCollectionId: null,
			} )
		);

		await waitFor( () =>
			expect(
				result.current.tree.map( ( node ) => node.page.id )
			).toEqual( [ 1 ] )
		);

		await act( async () => {
			window.dispatchEvent(
				new CustomEvent( SIDEBAR_TREE_CHANGED_EVENT, {
					detail: { parentId: ROOT_PARENT_ID, revealId: 2 },
				} )
			);
		} );

		await waitFor( () =>
			expect(
				result.current.tree.map( ( node ) => node.page.id )
			).toEqual( [ 1, 2 ] )
		);
	} );
} );
