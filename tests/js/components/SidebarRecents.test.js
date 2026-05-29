import { fireEvent, render, screen } from '@testing-library/react';

let mockRecents = [];
let mockIsResolving = false;
let mockRecordsById = new Map();
const mockNavigate = jest.fn();

jest.mock( '@tanstack/react-router', () => ( {
	useNavigate: () => mockNavigate,
} ) );

jest.mock( '@wordpress/components', () => ( {
	Button: ( { children, onClick, ...props } ) => (
		<button onClick={ onClick } { ...props }>
			{ children }
		</button>
	),
	Icon: ( { icon } ) => <span data-testid={ `icon-${ icon }` } />,
	Spinner: () => <span data-testid="spinner" />,
} ) );

jest.mock( '@wordpress/icons', () => ( {
	customPostType: 'custom-post-type',
	listItem: 'list-item',
	table: 'table',
	Icon: ( { icon } ) => <span data-testid={ `icon-${ icon }` } />,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityRecord: ( _kind, _postType, id ) => ( {
		record: mockRecordsById.get( id ) ?? null,
	} ),
} ) );

jest.mock( '../../../src/components/DocumentIcon', () => () => (
	<span data-testid="page-icon" />
) );

jest.mock( '../../../src/hooks/useRecents', () => ( {
	useRecents: () => ( {
		recents: mockRecents,
		isResolving: mockIsResolving,
	} ),
} ) );

import SidebarRecents from '../../../src/components/SidebarRecents';

function pageRecent( id, title ) {
	return {
		id,
		title,
		path: `${ title.toLowerCase() }-${ id }`,
	};
}

function rowRecent( id, title, collectionTitle ) {
	return {
		id,
		title,
		path: `books/${ title.toLowerCase() }-${ id }`,
		collection: { id: 12, title: collectionTitle, slug: 'books' },
	};
}

function collectionRecent( id, title ) {
	return {
		id,
		title,
		path: `${ title.toLowerCase() }-${ id }`,
	};
}

const rectForIndex = ( index ) => ( {
	top: index * 32,
	bottom: index * 32 + 28,
	left: 0,
	right: 120,
	width: 120,
	height: 28,
	x: 0,
	y: index * 32,
	toJSON: () => {},
} );

beforeEach( () => {
	mockNavigate.mockReset();
	mockRecents = [];
	mockIsResolving = false;
	mockRecordsById = new Map();
	window.Element.prototype.animate = jest.fn();
	window.Element.prototype.getAnimations = jest.fn( () => [] );
	window.matchMedia = jest.fn( () => ( { matches: false } ) );
	window.Element.prototype.getBoundingClientRect = function () {
		const list = this.parentElement;
		const index = list ? Array.from( list.children ).indexOf( this ) : 0;
		return rectForIndex( Math.max( index, 0 ) );
	};
} );

describe( 'SidebarRecents animation', () => {
	it( 'does not animate the initial recents fetch after a reload', () => {
		mockIsResolving = true;
		const { rerender } = render( <SidebarRecents /> );

		mockIsResolving = false;
		mockRecents = [ pageRecent( 1, 'Alpha' ), pageRecent( 2, 'Beta' ) ];
		rerender( <SidebarRecents /> );

		expect( window.Element.prototype.animate ).not.toHaveBeenCalled();
	} );

	it( 'animates rows that reposition after initial load', () => {
		mockRecents = [ pageRecent( 1, 'Alpha' ), pageRecent( 2, 'Beta' ) ];
		const { rerender } = render( <SidebarRecents /> );
		window.Element.prototype.animate.mockClear();

		mockRecents = [ pageRecent( 2, 'Beta' ), pageRecent( 1, 'Alpha' ) ];
		rerender( <SidebarRecents /> );

		expect( window.Element.prototype.animate ).toHaveBeenCalledTimes( 2 );
		expect( window.Element.prototype.animate ).toHaveBeenCalledWith(
			[
				expect.objectContaining( {
					transform: expect.stringMatching( /^translateY\(/ ),
				} ),
				{ transform: 'translateY(0)' },
			],
			expect.objectContaining( { duration: 180 } )
		);
	} );

	it( 'blurs the clicked recent before navigating', () => {
		const blurSpy = jest
			.spyOn( window.HTMLElement.prototype, 'blur' )
			.mockImplementation( () => {} );
		mockRecents = [ pageRecent( 1, 'Alpha' ) ];

		render( <SidebarRecents /> );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Recent page: Alpha' } )
		);

		expect( blurSpy ).toHaveBeenCalled();
		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'alpha-1' },
		} );
		blurSpy.mockRestore();
	} );

	it( 'shows a row recent with its collection in the title', () => {
		mockRecents = [ rowRecent( 7, 'War and Peace', 'Books' ) ];
		mockRecordsById.set( 7, { id: 7, crtxt_trait: [ 12 ], meta: {} } );

		render( <SidebarRecents /> );

		expect(
			screen.getByText( 'War and Peace in Books' )
		).toBeInTheDocument();
		expect(
			screen.getByRole( 'button', {
				name: 'Recent row: War and Peace in Books',
			} )
		).toBeInTheDocument();
	} );

	it( 'shows a collection recent with the table icon', () => {
		mockRecents = [ collectionRecent( 33, 'Library' ) ];
		mockRecordsById.set( 33, {
			id: 33,
			crtxt_trait: [],
			cortext_defines_trait: true,
			meta: { cortext_fields: [ 1 ] },
		} );

		const { container } = render( <SidebarRecents /> );

		expect(
			screen.getByRole( 'button', { name: 'Recent collection: Library' } )
		).toBeInTheDocument();
		expect(
			container.querySelector( '[data-testid="icon-table"]' )
		).toBeInTheDocument();
	} );

	it( 'shows a row recent with its custom icon when set', () => {
		// A row that has a `cortext_document_icon` stored renders that glyph
		// instead of the generic list-item fallback.
		const row = rowRecent( 11, 'Ada Lovelace', 'People' );
		row.icon = JSON.stringify( { type: 'wp', name: 'people' } );
		mockRecents = [ row ];
		mockRecordsById.set( 11, { id: 11, crtxt_trait: [ 12 ], meta: {} } );

		const { container } = render( <SidebarRecents /> );

		expect(
			container.querySelector( '[data-testid="page-icon"]' )
		).toBeInTheDocument();
		expect(
			container.querySelector( '[data-testid="icon-list-item"]' )
		).toBeNull();
	} );
} );
