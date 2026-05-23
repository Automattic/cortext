import { fireEvent, render, screen } from '@testing-library/react';

let mockRecents = [];
let mockIsResolving = false;
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

jest.mock( '../../../src/components/PageIcon', () => () => (
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
		kind: 'page',
		id,
		title,
		path: `page/${ title.toLowerCase() }-${ id }`,
	};
}

function rowRecent( id, title, collectionTitle ) {
	return {
		kind: 'row',
		id,
		title,
		path: `collection/books/${ title.toLowerCase() }-${ id }`,
		collection: { id: 12, title: collectionTitle, slug: 'books' },
	};
}

function collectionRecent( id, title ) {
	return {
		kind: 'collection',
		id,
		title,
		path: `collection/${ title.toLowerCase() }-${ id }`,
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
			params: { _splat: 'page/alpha-1' },
		} );
		blurSpy.mockRestore();
	} );

	it( 'shows a row recent with its collection in the title', () => {
		mockRecents = [ rowRecent( 7, 'War and Peace', 'Books' ) ];

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

	it( 'shows a collection recent with the table glyph', () => {
		mockRecents = [ collectionRecent( 33, 'Library' ) ];

		const { container } = render( <SidebarRecents /> );

		expect(
			screen.getByRole( 'button', { name: 'Recent collection: Library' } )
		).toBeInTheDocument();
		expect(
			container.querySelector( '[data-testid="icon-table"]' )
		).toBeInTheDocument();
	} );
} );
