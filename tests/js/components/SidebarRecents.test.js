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
	listItem: 'list-item',
	table: 'table',
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
} );
