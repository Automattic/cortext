import { findDataViewItemFromEvent } from '../../../src/components/dataViewItemLookup';

function eventFrom( target ) {
	return { target };
}

describe( 'findDataViewItemFromEvent', () => {
	afterEach( () => {
		document.body.innerHTML = '';
	} );

	it( 'resolves a grid card to the matching rendered row', () => {
		const wrapper = document.createElement( 'div' );
		wrapper.innerHTML = `
			<div class="dataviews-view-grid">
				<div class="dataviews-view-grid__card"><span>Alpha</span></div>
				<div class="dataviews-view-grid__card"><span>Beta</span></div>
			</div>
		`;
		document.body.appendChild( wrapper );

		const target = wrapper.querySelectorAll( 'span' )[ 1 ];
		const rowInfo = findDataViewItemFromEvent(
			eventFrom( target ),
			wrapper,
			'grid',
			[ { id: 10 }, { id: 20 } ]
		);

		expect( rowInfo ).toEqual( {
			id: '20',
			row: { id: 20 },
		} );
	} );

	it( 'resolves a list row to the matching rendered row', () => {
		const wrapper = document.createElement( 'div' );
		wrapper.innerHTML = `
			<div class="dataviews-view-list">
				<div role="row"><div class="dataviews-title-field">Alpha</div></div>
				<div role="row"><div class="dataviews-title-field">Beta</div></div>
			</div>
		`;
		document.body.appendChild( wrapper );

		const target = wrapper.querySelectorAll(
			'.dataviews-title-field'
		)[ 1 ];
		const rowInfo = findDataViewItemFromEvent(
			eventFrom( target ),
			wrapper,
			'list',
			[ { id: 10 }, { id: 20 } ]
		);

		expect( rowInfo ).toEqual( {
			id: '20',
			row: { id: 20 },
		} );
	} );

	it( 'resolves rows nested inside DataViews 17 list groups', () => {
		const wrapper = document.createElement( 'div' );
		wrapper.innerHTML = `
			<div class="dataviews-view-list">
				<div class="dataviews-view-list__group-wrapper">
					<h3>Group A</h3>
					<div role="row"><div class="dataviews-title-field">Alpha</div></div>
				</div>
				<div class="dataviews-view-list__group-wrapper">
					<h3>Group B</h3>
					<div role="row"><div class="dataviews-title-field">Beta</div></div>
				</div>
			</div>
		`;
		document.body.appendChild( wrapper );

		const target = wrapper.querySelectorAll(
			'.dataviews-title-field'
		)[ 1 ];
		const rowInfo = findDataViewItemFromEvent(
			eventFrom( target ),
			wrapper,
			'list',
			[ { id: 10 }, { id: 20 } ]
		);

		expect( rowInfo ).toEqual( {
			id: '20',
			row: { id: 20 },
		} );
	} );

	it( 'ignores list rows outside the current wrapper', () => {
		const wrapper = document.createElement( 'div' );
		const otherWrapper = document.createElement( 'div' );
		otherWrapper.innerHTML = `
			<div class="dataviews-view-list">
				<div role="row"><div class="dataviews-title-field">Beta</div></div>
			</div>
		`;
		document.body.append( wrapper, otherWrapper );

		const target = otherWrapper.querySelector( '.dataviews-title-field' );

		expect(
			findDataViewItemFromEvent( eventFrom( target ), wrapper, 'list', [
				{ id: 20 },
			] )
		).toBeNull();
	} );
} );
