import { scrollToEndQuickly } from '../../../src/components/dataViewScroll';

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
