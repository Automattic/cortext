import { act, renderHook, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';
import { store as coreStore } from '@wordpress/core-data';
import { createRegistry, RegistryProvider } from '@wordpress/data';

import useSidebarTree, {
	buildSidebarTreeBranchPath,
	overlaySidebarTreeRecord,
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

function createSidebarRegistry( records = [] ) {
	const registry = createRegistry();
	registry.register( coreStore );
	registry.dispatch( coreStore ).addEntities( [
		{
			kind: 'postType',
			name: 'crtxt_document',
			baseURL: '/wp/v2/crtxt_documents',
			key: 'id',
			rawAttributes: [ 'title', 'excerpt', 'content' ],
			mergedEdits: { meta: true },
			transientEdits: { blocks: true, selection: true },
		},
	] );
	records.forEach( ( record ) => {
		registry
			.dispatch( coreStore )
			.receiveEntityRecords( 'postType', 'crtxt_document', record );
		registry
			.dispatch( coreStore )
			.finishResolution( 'getEntityRecord', [
				'postType',
				'crtxt_document',
				record.id,
			] );
	} );
	return registry;
}

function registryWrapper( registry ) {
	return function Wrapper( { children } ) {
		return (
			<RegistryProvider value={ registry }>{ children }</RegistryProvider>
		);
	};
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

describe( 'overlaySidebarTreeRecord', () => {
	it( 'overlays tree fields without mutating the REST snapshots', () => {
		const rootRecord = makeRecord( 1 );
		rootRecord.meta.other = 'preserved';
		const duplicateRecord = { ...rootRecord, meta: { ...rootRecord.meta } };
		const untouchedBranch = {
			records: [ makeRecord( 2, 1 ) ],
			page: 1,
		};
		const branches = new Map( [
			[ 0, { records: [ rootRecord ], page: 1 } ],
			[ 1, untouchedBranch ],
			[ 2, { records: [ duplicateRecord ], page: 1 } ],
		] );
		const fields = {
			title: 'New title',
			icon: JSON.stringify( { type: 'emoji', value: '👍' } ),
			status: 'publish',
			slug: 'new-title',
		};

		const updated = overlaySidebarTreeRecord( branches, 1, fields );

		expect( updated ).not.toBe( branches );
		expect( updated.get( 0 ).records[ 0 ] ).toMatchObject( {
			title: { raw: 'New title', rendered: 'New title' },
			meta: {
				cortext_document_icon: fields.icon,
				other: 'preserved',
			},
			status: 'publish',
			slug: 'new-title',
		} );
		expect( updated.get( 0 ).records[ 0 ].meta.other ).toBe( 'preserved' );
		expect( updated.get( 2 ).records[ 0 ].meta.cortext_document_icon ).toBe(
			fields.icon
		);
		expect( updated.get( 1 ) ).toBe( untouchedBranch );
		expect( rootRecord ).toEqual(
			expect.objectContaining( {
				title: { raw: 'Page 1', rendered: 'Page 1' },
				meta: {
					cortext_document_icon: '',
					other: 'preserved',
				},
				status: 'private',
				slug: 'page-1',
			} )
		);
	} );

	it( 'preserves the map identity when every field is current', () => {
		const record = makeRecord( 1 );
		record.meta.cortext_document_icon = 'current';
		const branches = new Map( [ [ 0, { records: [ record ], page: 1 } ] ] );

		expect(
			overlaySidebarTreeRecord( branches, 1, {
				title: 'Page 1',
				icon: 'current',
				status: 'private',
				slug: 'page-1',
			} )
		).toBe( branches );
	} );

	it( 'leaves a texturized title alone when only `rendered` differs', () => {
		// WP runs `the_title` on `rendered`, so an unedited title with an
		// ampersand never matches the raw string core-data holds.
		const record = makeRecord( 1, 0, 'Tom & Jerry' );
		record.title.rendered = 'Tom &#038; Jerry';
		const branches = new Map( [ [ 0, { records: [ record ], page: 1 } ] ] );

		expect(
			overlaySidebarTreeRecord( branches, 1, {
				title: 'Tom & Jerry',
				icon: '',
				status: 'private',
				slug: 'page-1',
			} )
		).toBe( branches );
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

	it( 'derives selected tree fields from core-data across stale branch refetches', async () => {
		const serverRecord = makeRecord( 1, 0, 'Old title' );
		serverRecord.meta.cortext_document_icon = 'old-icon';
		const registry = createSidebarRegistry( [ serverRecord ] );
		mockTreeRequests( {
			records: { 1: serverRecord },
			branches: {
				'0:1': {
					records: [ serverRecord ],
					total: 1,
					totalPages: 1,
				},
			},
		} );

		const { result } = renderHook(
			() =>
				useSidebarTree( {
					selectedId: 1,
					selectedCollectionId: null,
				} ),
			{ wrapper: registryWrapper( registry ) }
		);

		await waitFor( () => expect( result.current.tree ).toHaveLength( 1 ) );

		act( () => {
			registry
				.dispatch( coreStore )
				.editEntityRecord( 'postType', 'crtxt_document', 1, {
					title: 'New title',
					meta: { cortext_document_icon: 'new-icon' },
					status: 'publish',
					slug: 'new-title',
				} );
		} );

		await waitFor( () =>
			expect( result.current.tree[ 0 ].page ).toMatchObject( {
				title: { raw: 'New title', rendered: 'New title' },
				meta: { cortext_document_icon: 'new-icon' },
				status: 'publish',
				slug: 'new-title',
			} )
		);
		expect( result.current.getBranch( ROOT_PARENT_ID ).records[ 0 ] ).toBe(
			serverRecord
		);

		await act( async () => {
			await result.current.refreshBranch( ROOT_PARENT_ID );
		} );

		expect( result.current.tree[ 0 ].page ).toMatchObject( {
			title: { raw: 'New title', rendered: 'New title' },
			meta: { cortext_document_icon: 'new-icon' },
			status: 'publish',
			slug: 'new-title',
		} );
		expect( result.current.getBranch( ROOT_PARENT_ID ).records[ 0 ] ).toBe(
			serverRecord
		);
		expect( serverRecord ).toMatchObject( {
			title: { raw: 'Old title', rendered: 'Old title' },
			meta: { cortext_document_icon: 'old-icon' },
			status: 'private',
			slug: 'page-1',
		} );
	} );

	it( 'leaves an unedited record alone when its title is texturized', async () => {
		const serverRecord = makeRecord( 1, 0, 'Tom & Jerry' );
		serverRecord.title.rendered = 'Tom &#038; Jerry';
		const registry = createSidebarRegistry( [ serverRecord ] );
		mockTreeRequests( {
			records: { 1: serverRecord },
			branches: {
				'0:1': {
					records: [ serverRecord ],
					total: 1,
					totalPages: 1,
				},
			},
		} );

		const { result } = renderHook(
			() =>
				useSidebarTree( {
					selectedId: 1,
					selectedCollectionId: null,
				} ),
			{ wrapper: registryWrapper( registry ) }
		);

		await waitFor( () => expect( result.current.tree ).toHaveLength( 1 ) );
		expect( result.current.tree[ 0 ].page ).toBe( serverRecord );
	} );

	it( 'leaves snapshots untouched when the selected id is absent from core-data', async () => {
		const serverRecord = makeRecord( 1, 0, 'Server title' );
		const registry = createSidebarRegistry();
		registry
			.dispatch( coreStore )
			.finishResolution( 'getEntityRecord', [
				'postType',
				'crtxt_document',
				99,
			] );
		mockTreeRequests( {
			branches: {
				'0:1': {
					records: [ serverRecord ],
					total: 1,
					totalPages: 1,
				},
			},
		} );

		const { result } = renderHook(
			() =>
				useSidebarTree( {
					selectedId: 99,
					selectedCollectionId: null,
				} ),
			{ wrapper: registryWrapper( registry ) }
		);

		await waitFor( () => expect( result.current.tree ).toHaveLength( 1 ) );
		expect( result.current.tree[ 0 ].page ).toBe( serverRecord );
	} );
} );
