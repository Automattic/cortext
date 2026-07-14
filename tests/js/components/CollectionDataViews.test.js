import { readFileSync } from 'fs';
import { join } from 'path';

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
	MockDataViews.Filters = () => null;
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
import {
	scrollElementInlineEndQuickly,
	scrollToEndQuickly,
} from '../../../src/components/dataViewScroll';
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

describe( 'CollectionDataViews DataViews 17 integration', () => {
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

	it( 'gives row reordering the same grouped order rendered by a server grid', () => {
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
		expect(
			mockDataViewRowReorder.mock.calls
				.at( -1 )[ 0 ]
				.rows.map( ( row ) => row.id )
		).toEqual( [ 1, 3, 2, 4 ] );
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
		expect(
			mockDataViewRowReorder.mock.calls
				.at( -1 )[ 0 ]
				.rows.map( ( row ) => row.id )
		).toEqual( [ 2, 4 ] );
	} );

	it( 'reveals system fields through the DataViews layout scroller', () => {
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
			} ),
			{ trackEnd: true }
		);
		expect( onFieldRevealed ).toHaveBeenCalledWith( 'created_at' );
	} );
} );

describe( 'CollectionDataViews loading styles', () => {
	it( 'does not reserve table space for empty DataViews loading notices', () => {
		const stylesheet = readFileSync(
			join( process.cwd(), 'src/components/CollectionDataViews.scss' ),
			'utf8'
		);

		const nonEmptyLoadingRule =
			stylesheet.match(
				/\.dataviews-loading:not\(:empty\)\s*\{[^}]*\}/
			)?.[ 0 ] ?? '';
		const emptyLoadingRule =
			stylesheet.match(
				/\.dataviews-loading:empty\s*\{[^}]*\}/
			)?.[ 0 ] ?? '';

		expect( nonEmptyLoadingRule ).toContain( 'min-height: 160px;' );
		expect( emptyLoadingRule ).toContain( 'display: none;' );
	} );

	it( 'uses DataViews structural hooks instead of legacy component stack classes', () => {
		const listStyles = readFileSync(
			join(
				process.cwd(),
				'src/components/CollectionDataViews.list.scss'
			),
			'utf8'
		);
		const gridStyles = readFileSync(
			join(
				process.cwd(),
				'src/components/CollectionDataViews.grid.scss'
			),
			'utf8'
		);
		const reorderStyles = readFileSync(
			join( process.cwd(), 'src/components/DataViewRowReorder.scss' ),
			'utf8'
		);

		expect( listStyles ).not.toContain( 'components-h-stack' );
		expect( gridStyles ).not.toContain( 'components-v-stack' );
		expect( reorderStyles ).not.toMatch( /components-[hv]-stack/ );
		expect( listStyles ).toMatch(
			/:where\(\[role="gridcell"\]:has\(> \.dataviews-view-list__item\)\)\s*\+\s*\*/
		);
		expect( gridStyles ).toMatch(
			/>\s*\.dataviews-view-grid__title-actions\s*\+\s*\*/
		);
		expect( reorderStyles ).toMatch(
			/>\s*\.dataviews-view-grid__title-actions\s*\+\s*\*/
		);
		expect( listStyles ).not.toMatch(
			/\.cortext-row-drag-handle\)[^{]+\.dataviews-view-list__media-wrapper:has\(img\)[^{]+left:\s*var\(--cortext-row-drag-content-offset\)/
		);
		expect( gridStyles ).toMatch(
			/>\s*\.dataviews-view-grid__title-actions\s*\+\s*\*\s*\{[^}]*padding:\s*0\s+0\s+\$grid-unit-15;/
		);
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

	it( 'marks the scroller when the create starts at the end', () => {
		const wrapper = makeScroller( { scrollLeft: 600 } );

		scrollToEndQuickly( wrapper, { snapIfAtEnd: true } );

		expect( wrapper.dataset.cortextRevealAtEnd ).toBe( 'true' );
		expect( wrapper.scrollLeft ).toBe( 600 );
	} );

	it( 'does not pre-scroll when the user is away from the end', () => {
		window.matchMedia = jest.fn( () => ( { matches: false } ) );
		window.requestAnimationFrame = jest.fn();
		const wrapper = makeScroller( { scrollLeft: 200 } );

		scrollToEndQuickly( wrapper, { snapIfAtEnd: true } );

		expect( wrapper.scrollLeft ).toBe( 200 );
		expect( wrapper.dataset.cortextRevealAtEnd ).toBeUndefined();
		expect( window.requestAnimationFrame ).not.toHaveBeenCalled();
	} );

	it( 'snaps to the new end without animating when already marked', () => {
		window.matchMedia = jest.fn( () => ( { matches: false } ) );
		window.requestAnimationFrame = jest.fn();
		const wrapper = makeScroller( { scrollLeft: 600 } );
		Object.defineProperty( wrapper, 'scrollWidth', {
			value: 1000,
			configurable: true,
		} );
		wrapper.dataset.cortextRevealAtEnd = 'true';

		scrollToEndQuickly( wrapper );

		expect( wrapper.scrollLeft ).toBe( 800 );
		expect( wrapper.dataset.cortextRevealAtEnd ).toBeUndefined();
		expect( window.requestAnimationFrame ).not.toHaveBeenCalled();
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

		scrollToEndQuickly( wrapper, { trackEnd: true } );
		Object.defineProperty( wrapper, 'scrollWidth', {
			value: 500,
			configurable: true,
		} );
		frame( 180 );

		expect( wrapper.scrollLeft ).toBe( 300 );
		now.mockRestore();
	} );

	it( 'keeps chasing the end without animation for reduced motion', () => {
		const now = jest
			.spyOn( window.performance, 'now' )
			.mockReturnValue( 0 );
		let frame;
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frame = callback;
			return 1;
		} );
		const wrapper = makeScroller( { scrollWidth: 200 } );

		scrollToEndQuickly( wrapper, { trackEnd: true } );
		Object.defineProperty( wrapper, 'scrollWidth', {
			value: 500,
			configurable: true,
		} );
		frame();

		expect( wrapper.scrollLeft ).toBe( 300 );
		now.mockRestore();
	} );

	it( 'stops chasing the end once the table width is stable', () => {
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

		scrollToEndQuickly( wrapper, { trackEnd: true } );
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

describe( 'scrollElementInlineEndQuickly', () => {
	let requestAnimationFrame;

	beforeEach( () => {
		requestAnimationFrame = window.requestAnimationFrame;
	} );

	afterEach( () => {
		window.requestAnimationFrame = requestAnimationFrame;
		document.body.innerHTML = '';
	} );

	it( 'reveals the element inline-end', () => {
		const element = document.createElement( 'div' );
		element.scrollIntoView = jest.fn();

		scrollElementInlineEndQuickly( element );

		expect( element.scrollIntoView ).toHaveBeenCalledWith( {
			block: 'nearest',
			inline: 'end',
			behavior: 'auto',
		} );
	} );

	it( 'pushes horizontal scroll ancestors to the end', () => {
		const parent = document.createElement( 'div' );
		const element = document.createElement( 'div' );
		element.scrollIntoView = jest.fn();
		parent.appendChild( element );
		Object.defineProperty( parent, 'clientWidth', {
			value: 200,
			configurable: true,
		} );
		Object.defineProperty( parent, 'scrollWidth', {
			value: 800,
			configurable: true,
		} );

		scrollElementInlineEndQuickly( element );

		expect( parent.scrollLeft ).toBe( 600 );
	} );

	it( 'animates horizontal scroll ancestors to the end', () => {
		const now = jest
			.spyOn( window.performance, 'now' )
			.mockReturnValue( 0 );
		let frame;
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frame = callback;
			return 1;
		} );
		const parent = document.createElement( 'div' );
		const element = document.createElement( 'div' );
		element.scrollIntoView = jest.fn();
		parent.appendChild( element );
		Object.defineProperty( parent, 'clientWidth', {
			value: 200,
			configurable: true,
		} );
		Object.defineProperty( parent, 'scrollWidth', {
			value: 800,
			configurable: true,
		} );

		scrollElementInlineEndQuickly( element, { trackEnd: true } );
		expect( parent.scrollLeft ).toBe( 0 );
		frame( 90 );
		expect( parent.scrollLeft ).toBeGreaterThan( 0 );
		expect( parent.scrollLeft ).toBeLessThan( 600 );
		frame( 180 );

		expect( parent.scrollLeft ).toBe( 600 );
		expect( element.scrollIntoView ).not.toHaveBeenCalled();
		now.mockRestore();
	} );

	it( 'keeps scrolling ancestors while the layout settles', () => {
		const now = jest
			.spyOn( window.performance, 'now' )
			.mockReturnValue( 0 );
		let frame;
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frame = callback;
			return 1;
		} );
		const parent = document.createElement( 'div' );
		const element = document.createElement( 'div' );
		parent.appendChild( element );
		Object.defineProperty( parent, 'clientWidth', {
			value: 200,
			configurable: true,
		} );
		Object.defineProperty( parent, 'scrollWidth', {
			value: 200,
			configurable: true,
		} );

		scrollElementInlineEndQuickly( element, { trackEnd: true } );
		Object.defineProperty( parent, 'scrollWidth', {
			value: 500,
			configurable: true,
		} );
		frame( 180 );

		expect( parent.scrollLeft ).toBe( 300 );
		now.mockRestore();
	} );

	it( 'stops tracking when the user scrolls an ancestor during settle', () => {
		const now = jest
			.spyOn( window.performance, 'now' )
			.mockReturnValue( 0 );
		const frames = [];
		window.requestAnimationFrame = jest.fn( ( callback ) => {
			frames.push( callback );
			return frames.length;
		} );
		const parent = document.createElement( 'div' );
		const element = document.createElement( 'div' );
		parent.appendChild( element );
		Object.defineProperty( parent, 'clientWidth', {
			value: 200,
			configurable: true,
		} );
		Object.defineProperty( parent, 'scrollWidth', {
			value: 800,
			configurable: true,
		} );

		scrollElementInlineEndQuickly( element, { trackEnd: true } );
		frames.shift()( 180 );
		parent.scrollLeft = 200;
		frames.shift()();

		expect( parent.scrollLeft ).toBe( 200 );
		expect( frames ).toHaveLength( 0 );
		now.mockRestore();
	} );
} );
