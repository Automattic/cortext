import { readFileSync } from 'fs';
import { join } from 'path';

import { render } from '@testing-library/react';
import { DataViews as mockDataViews } from '@wordpress/dataviews/wp';

jest.mock( '@wordpress/dataviews/wp', () => {
	const MockDataViews = jest.fn( ( { children } ) => (
		<div data-testid="dataviews">{ children }</div>
	) );
	MockDataViews.Search = () => null;
	MockDataViews.FiltersToggle = () => null;
	MockDataViews.LayoutSwitcher = () => null;
	MockDataViews.ViewConfig = () => null;
	MockDataViews.Filters = () => null;
	MockDataViews.Layout = () => null;
	MockDataViews.Pagination = () => null;
	return { DataViews: MockDataViews };
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
jest.mock( '../../../src/components/DataViewRowReorder', () => () => null );
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
} );
