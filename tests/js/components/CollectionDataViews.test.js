import { act, render, waitFor } from '@testing-library/react';
import { DataViews as mockDataViews } from '@wordpress/dataviews/wp';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockDataViewRowReorder = jest.fn( () => null );
const mockSetFavorites = jest.fn();
const mockOpenDocument = jest.fn();
const mockCloseDocument = jest.fn();

jest.mock( '@wordpress/dataviews/wp', () => {
	const actual = jest.requireActual( '@wordpress/dataviews/wp' );
	const MockDataViews = jest.fn( ( { children } ) => (
		<div className="dataviews-wrapper" data-testid="dataviews">
			{ children }
		</div>
	) );
	MockDataViews.Search = () => <input type="search" aria-label="Search" />;
	MockDataViews.FiltersToggle = () => null;
	MockDataViews.LayoutSwitcher = () => <button>Layout</button>;
	MockDataViews.ViewConfig = () => <button>View options</button>;
	MockDataViews.FiltersToggled = () => null;
	MockDataViews.Layout = () => (
		<div className="dataviews-layout__container" />
	);
	MockDataViews.Pagination = () => null;
	return { ...actual, DataViews: MockDataViews };
} );

jest.mock( '../../../src/components/CollectionFieldsContext', () => ( {
	useCollectionFieldsContext: jest.fn(),
} ) );

jest.mock( '../../../src/hooks/useCollectionRows', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '../../../src/hooks/useRecents', () => ( {
	useRecents: jest.fn( () => ( { touchRecent: jest.fn() } ) ),
} ) );

jest.mock( '../../../src/hooks/useFavorites', () => ( {
	useFavorites: jest.fn( () => ( {
		setFavorites: jest.fn().mockResolvedValue( undefined ),
	} ) ),
} ) );

jest.mock( '../../../src/documents', () => ( {
	filterFavoritesByDeletedIds: jest.fn( ( favorites ) => favorites ),
	useFavoriteToggle: jest.fn( () => ( {
		isFavorite: jest.fn( () => false ),
		toggle: jest.fn(),
		disabled: false,
	} ) ),
} ) );

jest.mock( '../../../src/components/DocumentPeekProvider', () => ( {
	useDocumentPeekActions: jest.fn( () => ( {
		openDocument: mockOpenDocument,
		closeDocument: mockCloseDocument,
	} ) ),
	useDocumentPeekState: jest.fn( () => ( { peek: null } ) ),
} ) );

jest.mock( '../../../src/components/RowDetailView', () => ( {
	ROW_DETAIL_MODE_ICONS: { side: null, modal: null, full: null },
	ROW_DETAIL_MODE_LABELS: {
		side: 'Side peek',
		modal: 'Center modal',
		full: 'Full page',
	},
} ) );

jest.mock(
	'../../../src/components/DataViewColumnInteractions',
	() => () => null
);
jest.mock(
	'../../../src/components/DataViewRowReorder',
	() => ( props ) => mockDataViewRowReorder( props )
);
jest.mock( '../../../src/components/GridNewRowPortal', () => () => null );
jest.mock(
	'../../../src/components/TableCalculationsFooter',
	() => () => null
);
jest.mock(
	'../../../src/components/fields/ColumnHeaderActions',
	() => () => null
);
jest.mock( '../../../src/components/DataViewNewRowButton', () => () => (
	<button className="cortext-data-view__new-row">New</button>
) );
jest.mock( '../../../src/components/Skeleton', () => ( {
	CollectionRowsSkeleton: () => <div data-testid="rows-skeleton" />,
} ) );
jest.mock( '../../../src/hooks/afterNextPaint', () => ( {
	__esModule: true,
	default: jest.fn( () => Promise.resolve() ),
} ) );
jest.mock( '../../../src/hooks/viewTransition', () => ( {
	whenViewTransitionsSettled: jest.fn( () => Promise.resolve() ),
} ) );
jest.mock( '../../../src/components/dataViewScroll', () => {
	const actual = jest.requireActual(
		'../../../src/components/dataViewScroll'
	);
	return {
		...actual,
		scrollToEndQuickly: jest.fn( actual.scrollToEndQuickly ),
	};
} );

import { useCollectionFieldsContext } from '../../../src/components/CollectionFieldsContext';
import CollectionDataViews from '../../../src/components/CollectionDataViews';
import { scrollToEndQuickly } from '../../../src/components/dataViewScroll';
import { whenViewTransitionsSettled } from '../../../src/hooks/viewTransition';
import useCollectionRows from '../../../src/hooks/useCollectionRows';
import { useFavorites } from '../../../src/hooks/useFavorites';
import { filterFavoritesByDeletedIds } from '../../../src/documents';
import apiFetch from '@wordpress/api-fetch';
import {
	useDocumentPeekActions,
	useDocumentPeekState,
} from '../../../src/components/DocumentPeekProvider';

const tableView = {
	type: 'table',
	fields: [ 'title', 'field-11' ],
	page: 1,
	perPage: 10,
	layout: { density: 'compact' },
};

const collectionFieldState = {
	fields: [
		{
			id: 'field-11',
			label: 'Priority',
			header: 'Priority',
			editable: true,
			type: 'text',
		},
	],
	collection: { id: 7, meta: { slug: 'projects' } },
	slug: 'projects',
	isResolving: false,
	fieldsResolved: true,
};

function collectionRowsState( overrides = {} ) {
	return {
		data: [],
		paginationInfo: { totalItems: 0, totalPages: 1 },
		isLoading: false,
		hasResolved: true,
		error: null,
		refresh: jest.fn(),
		mutateRows: jest.fn(),
		queryMode: 'server',
		...overrides,
	};
}

function deferred() {
	let resolve;
	const promise = new Promise( ( promiseResolve ) => {
		resolve = promiseResolve;
	} );
	return { promise, resolve };
}

function makeScroller( {
	direction = 'ltr',
	scrollLeft = 0,
	scrollWidth = 800,
	clientWidth = 200,
} = {} ) {
	const wrapper = document.createElement( 'div' );
	Object.defineProperty( wrapper, 'clientWidth', {
		value: clientWidth,
		configurable: true,
	} );
	Object.defineProperty( wrapper, 'scrollWidth', {
		value: scrollWidth,
		configurable: true,
	} );
	wrapper.scrollLeft = scrollLeft;
	wrapper.style.direction = direction;
	document.body.appendChild( wrapper );
	return wrapper;
}

describe( 'CollectionDataViews loading state', () => {
	beforeEach( () => {
		mockDataViews.mockClear();
		mockDataViewRowReorder.mockClear();
		whenViewTransitionsSettled.mockImplementation( () =>
			Promise.resolve()
		);
		useCollectionFieldsContext.mockReturnValue( collectionFieldState );
	} );

	it( 'keeps DataViews out of loading mode during row refreshes with visible rows', () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: [
					{
						id: 1,
						title: { raw: 'Row detail editing' },
						meta: { 'field-11': 'Urgent' },
					},
				],
				paginationInfo: { totalItems: 1, totalPages: 1 },
				isLoading: true,
			} )
		);

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
			/>
		);

		expect( mockDataViews ).toHaveBeenCalled();
		expect( mockDataViews.mock.calls.at( -1 )[ 0 ].isLoading ).toBe(
			false
		);
	} );

	it( 'passes loading through to DataViews before rows are available', () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				isLoading: true,
				hasResolved: false,
			} )
		);

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
			/>
		);

		expect( mockDataViews ).toHaveBeenCalled();
		expect( mockDataViews.mock.calls.at( -1 )[ 0 ].isLoading ).toBe( true );
	} );
} );

describe( 'CollectionDataViews surface focus', () => {
	beforeEach( () => {
		mockDataViews.mockClear();
		mockDataViewRowReorder.mockClear();
		useCollectionFieldsContext.mockReturnValue( collectionFieldState );
	} );

	function focusOrigin() {
		const originElement = document.createElement( 'button' );
		document.body.appendChild( originElement );
		originElement.focus();
		return originElement;
	}

	function createFulfillingCompletion() {
		return jest.fn( ( token, onConsume ) => {
			onConsume?.();
			return true;
		} );
	}

	it( 'focuses Search when the collection has rows', async () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: [ { id: 1, title: { raw: 'First row' } } ],
				paginationInfo: { totalItems: 1, totalPages: 1 },
			} )
		);
		const originElement = focusOrigin();
		const completeSurfaceFocus = createFulfillingCompletion();
		const { container } = render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
				surfaceFocusRequest={ {
					token: 11,
					documentId: '7',
					originElement,
				} }
				isEditorSurfaceDisplayed
				completeSurfaceFocus={ completeSurfaceFocus }
			/>
		);

		await waitFor( () => {
			expect( completeSurfaceFocus ).toHaveBeenCalledWith(
				11,
				expect.any( Function )
			);
			expect(
				container.querySelector( 'input[type="search"]' )
			).toHaveFocus();
		} );
		originElement.remove();
	} );

	it( 'focuses New when the collection is empty and unfiltered', async () => {
		useCollectionRows.mockReturnValue( collectionRowsState() );
		const originElement = focusOrigin();
		const completeSurfaceFocus = createFulfillingCompletion();
		const { container } = render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
				surfaceFocusRequest={ {
					token: 12,
					documentId: 7,
					originElement,
				} }
				isEditorSurfaceDisplayed
				completeSurfaceFocus={ completeSurfaceFocus }
			/>
		);

		await waitFor( () => {
			expect( completeSurfaceFocus ).toHaveBeenCalledWith(
				12,
				expect.any( Function )
			);
			expect(
				container.querySelector( '.cortext-data-view__new-row' )
			).toHaveFocus();
		} );
		originElement.remove();
	} );

	it( 'waits until the requested collection is visible', async () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: [ { id: 1, title: { raw: 'First row' } } ],
				paginationInfo: { totalItems: 1, totalPages: 1 },
			} )
		);
		const originElement = focusOrigin();
		const completeSurfaceFocus = createFulfillingCompletion();
		const request = { token: 13, documentId: 7, originElement };
		const props = {
			collectionId: 7,
			view: tableView,
			onChangeView: jest.fn(),
			surfaceFocusRequest: request,
			completeSurfaceFocus,
		};
		const { rerender } = render(
			<CollectionDataViews
				{ ...props }
				isEditorSurfaceDisplayed={ false }
			/>
		);

		expect( completeSurfaceFocus ).not.toHaveBeenCalled();
		expect( originElement ).toHaveFocus();

		rerender(
			<CollectionDataViews { ...props } isEditorSurfaceDisplayed />
		);
		await waitFor( () =>
			expect( completeSurfaceFocus ).toHaveBeenCalledWith(
				13,
				expect.any( Function )
			)
		);
		originElement.remove();
	} );

	it( 'consumes the request without moving focus when rows fail', () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( { error: new Error( 'Rows failed' ) } )
		);
		const originElement = focusOrigin();
		const completeSurfaceFocus = jest.fn( () => true );

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
				surfaceFocusRequest={ {
					token: 14,
					documentId: 7,
					originElement,
				} }
				isEditorSurfaceDisplayed
				completeSurfaceFocus={ completeSurfaceFocus }
			/>
		);

		expect( completeSurfaceFocus ).toHaveBeenCalledWith( 14 );
		expect( originElement ).toHaveFocus();
		originElement.remove();
	} );

	it( 'waits for the editor lock, then consumes without moving focus if the surface is read-only', async () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: [ { id: 1, title: { raw: 'First row' } } ],
				paginationInfo: { totalItems: 1, totalPages: 1 },
			} )
		);
		const originElement = focusOrigin();
		const completeSurfaceFocus = jest.fn( () => true );
		const request = { token: 17, documentId: 7, originElement };
		const props = {
			collectionId: 7,
			view: tableView,
			onChangeView: jest.fn(),
			surfaceFocusRequest: request,
			isEditorSurfaceDisplayed: true,
			completeSurfaceFocus,
		};
		const { rerender } = render(
			<CollectionDataViews { ...props } isSurfaceFocusPending />
		);

		expect( completeSurfaceFocus ).not.toHaveBeenCalled();
		expect( originElement ).toHaveFocus();

		rerender( <CollectionDataViews { ...props } isSurfaceFocusReadOnly /> );
		await waitFor( () =>
			expect( completeSurfaceFocus ).toHaveBeenCalledWith( 17 )
		);
		expect( originElement ).toHaveFocus();
		originElement.remove();
	} );

	it( "keeps the user's new focus while the view transition finishes", async () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: [ { id: 1, title: { raw: 'First row' } } ],
				paginationInfo: { totalItems: 1, totalPages: 1 },
			} )
		);
		let settleTransition;
		whenViewTransitionsSettled.mockImplementationOnce(
			() =>
				new Promise( ( resolve ) => {
					settleTransition = resolve;
				} )
		);
		const originElement = focusOrigin();
		const newTarget = document.createElement( 'button' );
		document.body.appendChild( newTarget );
		const completeSurfaceFocus = jest.fn( () => true );
		const { container } = render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
				surfaceFocusRequest={ {
					token: 15,
					documentId: 7,
					originElement,
				} }
				isEditorSurfaceDisplayed
				completeSurfaceFocus={ completeSurfaceFocus }
			/>
		);

		newTarget.focus();
		settleTransition();
		await waitFor( () =>
			expect( completeSurfaceFocus ).toHaveBeenCalledWith( 15 )
		);
		expect( newTarget ).toHaveFocus();
		expect(
			container.querySelector( 'input[type="search"]' )
		).not.toHaveFocus();
		originElement.remove();
		newTarget.remove();
	} );

	it( 'leaves focus alone when another consumer has claimed the request', async () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: [ { id: 1, title: { raw: 'First row' } } ],
				paginationInfo: { totalItems: 1, totalPages: 1 },
			} )
		);
		const originElement = focusOrigin();
		const completeSurfaceFocus = jest.fn( () => false );
		const { container } = render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
				surfaceFocusRequest={ {
					token: 16,
					documentId: 7,
					originElement,
				} }
				isEditorSurfaceDisplayed
				completeSurfaceFocus={ completeSurfaceFocus }
			/>
		);

		await waitFor( () =>
			expect( completeSurfaceFocus ).toHaveBeenCalledWith(
				16,
				expect.any( Function )
			)
		);
		expect( originElement ).toHaveFocus();
		expect(
			container.querySelector( 'input[type="search"]' )
		).not.toHaveFocus();
		originElement.remove();
	} );
} );

describe( 'CollectionDataViews archive actions', () => {
	beforeEach( () => {
		mockDataViews.mockClear();
		useCollectionFieldsContext.mockReturnValue( collectionFieldState );
		apiFetch.mockReset();
		apiFetch.mockResolvedValue( { archived: [] } );
		filterFavoritesByDeletedIds.mockClear();
		mockSetFavorites.mockReset();
		mockSetFavorites.mockImplementation( async ( update ) =>
			update( [ { id: 1 }, { id: 2 }, { id: 3 } ] )
		);
		useFavorites.mockReturnValue( { setFavorites: mockSetFavorites } );
		mockOpenDocument.mockReset();
		mockCloseDocument.mockReset();
		mockCloseDocument.mockResolvedValue( true );
		useDocumentPeekActions.mockReturnValue( {
			openDocument: mockOpenDocument,
			closeDocument: mockCloseDocument,
		} );
		useDocumentPeekState.mockReturnValue( { peek: null } );
	} );

	it( 'offers bulk Archive before Trash and archives every selected row', async () => {
		const rows = [
			{ id: 1, title: { raw: 'One' } },
			{ id: 2, title: { raw: 'Two' } },
		];
		const rowsState = collectionRowsState( {
			data: rows,
			paginationInfo: { totalItems: 2, totalPages: 1 },
		} );
		useCollectionRows.mockReturnValue( rowsState );
		apiFetch
			.mockReset()
			.mockResolvedValueOnce( {
				archived: [ 1, 3 ],
				post: { id: 1, status: 'crtxt_archived' },
			} )
			.mockResolvedValueOnce( {
				archived: [ 2 ],
				post: { id: 2, status: 'crtxt_archived' },
			} );

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
			/>
		);

		const actions = mockDataViews.mock.calls.at( -1 )[ 0 ].actions;
		const archiveAction = actions.find(
			( action ) => action.id === 'archive-row'
		);
		const trashAction = actions.find(
			( action ) => action.id === 'delete-row'
		);
		expect( archiveAction.supportsBulk ).toBe( true );
		expect( actions.indexOf( archiveAction ) ).toBeLessThan(
			actions.indexOf( trashAction )
		);

		await act( async () => {
			await archiveAction.callback( rows );
		} );

		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( apiFetch ).toHaveBeenNthCalledWith( 1, {
			path: '/cortext/v1/documents/1/archive',
			method: 'POST',
		} );
		expect( apiFetch ).toHaveBeenNthCalledWith( 2, {
			path: '/cortext/v1/documents/2/archive',
			method: 'POST',
		} );
		expect( rowsState.refresh ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'flushes and closes an open selected row before archiving it', async () => {
		const row = { id: 1, title: { raw: 'One' } };
		const close = deferred();
		const rowsState = collectionRowsState( {
			data: [ row ],
			paginationInfo: { totalItems: 1, totalPages: 1 },
		} );
		useCollectionRows.mockReturnValue( rowsState );
		useDocumentPeekState.mockReturnValue( {
			peek: { docId: 1, mode: 'side' },
		} );
		mockCloseDocument.mockReturnValue( close.promise );
		apiFetch.mockResolvedValue( {
			archived: [ 1 ],
			post: { id: 1, status: 'crtxt_archived' },
		} );

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
			/>
		);

		const archiveAction = mockDataViews.mock.calls
			.at( -1 )[ 0 ]
			.actions.find( ( action ) => action.id === 'archive-row' );
		let archivePromise;
		act( () => {
			archivePromise = archiveAction.callback( [ row ] );
		} );
		await act( async () => Promise.resolve() );

		expect( apiFetch ).not.toHaveBeenCalled();

		await act( async () => {
			close.resolve( true );
			await archivePromise;
		} );

		expect( mockCloseDocument ).toHaveBeenCalledTimes( 1 );
		expect( mockCloseDocument.mock.invocationCallOrder[ 0 ] ).toBeLessThan(
			apiFetch.mock.invocationCallOrder[ 0 ]
		);
		expect( apiFetch ).toHaveBeenCalledWith( {
			path: '/cortext/v1/documents/1/archive',
			method: 'POST',
		} );
	} );

	it( 'aborts archive when an open selected row cannot be saved', async () => {
		const row = { id: 1, title: { raw: 'One' } };
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: [ row ],
				paginationInfo: { totalItems: 1, totalPages: 1 },
			} )
		);
		useDocumentPeekState.mockReturnValue( {
			peek: { docId: 1, mode: 'modal' },
		} );
		mockCloseDocument.mockResolvedValue( false );

		const { findAllByText } = render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
			/>
		);

		const archiveAction = mockDataViews.mock.calls
			.at( -1 )[ 0 ]
			.actions.find( ( action ) => action.id === 'archive-row' );
		await act( async () => {
			await archiveAction.callback( [ row ] );
		} );

		expect( apiFetch ).not.toHaveBeenCalled();
		expect(
			await findAllByText(
				'Could not save changes. Archive was canceled.'
			)
		).not.toHaveLength( 0 );
	} );

	it( 'always includes trashed row roots with real cascade DELETE ids', async () => {
		const rows = [ { id: 1 }, { id: 2 } ];
		const rowsState = collectionRowsState( {
			data: rows,
			paginationInfo: { totalItems: 2, totalPages: 1 },
		} );
		useCollectionRows.mockReturnValue( rowsState );
		apiFetch
			.mockReset()
			.mockResolvedValueOnce( {
				id: 1,
				status: 'trash',
				cascade_deleted: [ 3 ],
			} )
			.mockResolvedValueOnce( {
				id: 2,
				status: 'trash',
				cascade_deleted: [],
			} );

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ tableView }
				onChangeView={ jest.fn() }
			/>
		);

		const trashAction = mockDataViews.mock.calls
			.at( -1 )[ 0 ]
			.actions.find( ( action ) => action.id === 'delete-row' );
		await act( async () => {
			await trashAction.callback( rows );
		} );

		expect( filterFavoritesByDeletedIds ).toHaveBeenCalledWith(
			[ { id: 1 }, { id: 2 }, { id: 3 } ],
			new Set( [ 1, 2, 3 ] )
		);
		expect( rowsState.refresh ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'CollectionDataViews with DataViews 17', () => {
	const groupedRows = [
		{ id: 1, status: 'B' },
		{ id: 2, status: 'A' },
		{ id: 3, status: 'B' },
		{ id: 4, status: 'A' },
	];
	const groupedFieldState = {
		...collectionFieldState,
		fields: [
			{
				...collectionFieldState.fields[ 0 ],
				getValue: ( { item } ) => item.status,
				sort: ( left, right, direction ) =>
					direction === 'desc'
						? right.localeCompare( left )
						: left.localeCompare( right ),
			},
		],
	};
	const legacyGroupedGridView = {
		type: 'grid',
		fields: [ 'title', 'field-11' ],
		fieldsByType: { grid: [], list: [] },
		layout: { previewSize: 230 },
		layoutByType: {
			table: { density: 'compact' },
			grid: { previewSize: 230 },
			list: {},
		},
		groupByField: 'field-11',
		page: 1,
		perPage: 10,
	};

	beforeEach( () => {
		mockDataViews.mockClear();
		mockDataViewRowReorder.mockClear();
		scrollToEndQuickly.mockClear();
		useCollectionFieldsContext.mockReturnValue( groupedFieldState );
	} );

	it( 'does not rewrite legacy fixed max widths on mount', () => {
		useCollectionRows.mockReturnValue( collectionRowsState() );
		const onChangeView = jest.fn();

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ {
					...tableView,
					layout: {
						density: 'compact',
						styles: {
							'field-11': {
								width: 180,
								minWidth: 52,
								maxWidth: 180,
							},
						},
					},
				} }
				onChangeView={ onChangeView }
			/>
		);

		expect( onChangeView ).not.toHaveBeenCalled();
		expect(
			mockDataViews.mock.calls.at( -1 )[ 0 ].view.layout.styles[
				'field-11'
			].maxWidth
		).toBe( 180 );
	} );

	it( 'migrates legacy grouping without enabling row reordering', () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: groupedRows,
				paginationInfo: { totalItems: 4, totalPages: 1 },
			} )
		);

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ legacyGroupedGridView }
				onChangeView={ jest.fn() }
			/>
		);

		const dataViewsProps = mockDataViews.mock.calls.at( -1 )[ 0 ];
		expect( dataViewsProps.data.map( ( row ) => row.id ) ).toEqual( [
			1, 2, 3, 4,
		] );
		expect( dataViewsProps.view.groupBy ).toEqual( {
			field: 'field-11',
			direction: 'asc',
		} );
		expect( dataViewsProps.view.groupByField ).toBeUndefined();
		expect( mockDataViewRowReorder ).not.toHaveBeenCalled();
	} );

	it( 'applies migrated grouping before client-side pagination', () => {
		useCollectionRows.mockReturnValue(
			collectionRowsState( {
				data: groupedRows,
				paginationInfo: { totalItems: 4, totalPages: 2 },
				queryMode: 'client',
			} )
		);

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ { ...legacyGroupedGridView, perPage: 2 } }
				onChangeView={ jest.fn() }
			/>
		);

		expect(
			mockDataViews.mock.calls.at( -1 )[ 0 ].data.map( ( row ) => row.id )
		).toEqual( [ 2, 4 ] );
		expect( mockDataViewRowReorder ).not.toHaveBeenCalled();
	} );

	it( 'scrolls the DataViews layout to reveal system fields', () => {
		useCollectionFieldsContext.mockReturnValue( {
			...collectionFieldState,
			fields: [
				...collectionFieldState.fields,
				{
					id: 'created_at',
					label: 'Created',
					header: 'Created',
					getValue: ( { item } ) => item.created_at,
				},
			],
		} );
		useCollectionRows.mockReturnValue( collectionRowsState() );
		const onFieldRevealed = jest.fn();

		render(
			<CollectionDataViews
				collectionId={ 7 }
				view={ {
					...tableView,
					fields: [ ...tableView.fields, 'created_at' ],
				} }
				revealFieldId="created_at"
				onFieldRevealed={ onFieldRevealed }
				onChangeView={ jest.fn() }
			/>
		);

		expect( scrollToEndQuickly ).toHaveBeenCalledWith(
			expect.objectContaining( {
				className: 'dataviews-layout__container',
			} )
		);
		expect( onFieldRevealed ).toHaveBeenCalledWith( 'created_at' );
	} );
} );

describe( 'scrollToEndQuickly', () => {
	let matchMedia;
	let requestAnimationFrame;

	beforeEach( () => {
		matchMedia = window.matchMedia;
		window.matchMedia = jest.fn( () => ( { matches: true } ) );
		requestAnimationFrame = window.requestAnimationFrame;
	} );

	afterEach( () => {
		window.matchMedia = matchMedia;
		window.requestAnimationFrame = requestAnimationFrame;
		document.body.innerHTML = '';
	} );

	it( 'uses positive scrollLeft for LTR tables', () => {
		const wrapper = makeScroller();

		scrollToEndQuickly( wrapper );

		expect( wrapper.scrollLeft ).toBe( 600 );
	} );

	it( 'uses negative scrollLeft for RTL tables', () => {
		const wrapper = makeScroller( { direction: 'rtl' } );

		scrollToEndQuickly( wrapper );

		expect( wrapper.scrollLeft ).toBe( -600 );
	} );

	it( 'keeps chasing the end while the table grows', () => {
		window.matchMedia = jest.fn( () => ( { matches: false } ) );
		const now = jest
			.spyOn( window.performance, 'now' )
			.mockReturnValue( 0 );
		let frame;
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frame = callback;
			return 1;
		} );
		const wrapper = makeScroller( { scrollWidth: 200 } );

		scrollToEndQuickly( wrapper );
		Object.defineProperty( wrapper, 'scrollWidth', {
			value: 500,
			configurable: true,
		} );
		frame( 180 );

		expect( wrapper.scrollLeft ).toBe( 300 );
		now.mockRestore();
	} );

	it( 'tracks the table edge without animation for reduced motion', () => {
		const now = jest
			.spyOn( window.performance, 'now' )
			.mockReturnValue( 0 );
		let frame;
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frame = callback;
			return 1;
		} );
		const wrapper = makeScroller( { scrollWidth: 200 } );

		scrollToEndQuickly( wrapper );
		Object.defineProperty( wrapper, 'scrollWidth', {
			value: 500,
			configurable: true,
		} );
		frame();

		expect( wrapper.scrollLeft ).toBe( 300 );
		now.mockRestore();
	} );

	it( 'stops following the edge when the user scrolls away', () => {
		const frames = [];
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frames.push( callback );
			return frames.length;
		} );
		const wrapper = makeScroller();

		scrollToEndQuickly( wrapper );
		wrapper.scrollLeft = 200;
		frames.shift()();

		expect( wrapper.scrollLeft ).toBe( 200 );
		expect( frames ).toHaveLength( 0 );
	} );

	it( 'stops tracking the table edge once its width is stable', () => {
		window.matchMedia = jest.fn( () => ( { matches: false } ) );
		const now = jest
			.spyOn( window.performance, 'now' )
			.mockReturnValue( 0 );
		const frames = [];
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frames.push( callback );
			return frames.length;
		} );
		const wrapper = makeScroller( { scrollWidth: 200 } );

		scrollToEndQuickly( wrapper );
		Object.defineProperty( wrapper, 'scrollWidth', {
			value: 500,
			configurable: true,
		} );
		frames.shift()( 180 );
		expect( wrapper.scrollLeft ).toBe( 300 );
		frames.shift()();
		frames.shift()();
		frames.shift()();

		expect( frames ).toHaveLength( 0 );
		now.mockRestore();
	} );
} );
