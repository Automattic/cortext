import { render } from '@testing-library/react';
import { DataViews as mockDataViews } from '@wordpress/dataviews/wp';

const mockDataViewRowReorder = jest.fn( () => null );

jest.mock( '@wordpress/dataviews/wp', () => {
	const actual = jest.requireActual( '@wordpress/dataviews/wp' );
	const MockDataViews = jest.fn( ( { children } ) => (
		<div className="dataviews-wrapper" data-testid="dataviews">
			{ children }
		</div>
	) );
	MockDataViews.Search = () => null;
	MockDataViews.FiltersToggle = () => null;
	MockDataViews.LayoutSwitcher = () => null;
	MockDataViews.ViewConfig = () => null;
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
	useFavorites: jest.fn( () => ( { setFavorites: jest.fn() } ) ),
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
		openDocument: jest.fn(),
		closeDocument: jest.fn(),
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
jest.mock( '../../../src/components/DataViewNewRowButton', () => () => null );
jest.mock( '../../../src/components/Skeleton', () => ( {
	CollectionRowsSkeleton: () => <div data-testid="rows-skeleton" />,
} ) );
jest.mock( '../../../src/hooks/afterNextPaint', () => ( {
	__esModule: true,
	default: jest.fn( () => Promise.resolve() ),
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
import useCollectionRows from '../../../src/hooks/useCollectionRows';

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
