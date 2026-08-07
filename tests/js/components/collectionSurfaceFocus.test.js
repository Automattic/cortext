import {
	getCollectionSurfaceFocusTarget,
	isCollectionTrulyEmpty,
	isSurfaceFocusOriginCurrent,
} from '../../../src/components/collectionSurfaceFocus';

function collectionRoot( markup ) {
	const root = document.createElement( 'div' );
	root.innerHTML = markup;
	return root;
}

describe( 'getCollectionSurfaceFocusTarget', () => {
	it( 'chooses New before Search when the collection is empty and unfiltered', () => {
		const root = collectionRoot( `
			<div data-cortext-focus-region="search"><input type="search" /></div>
			<button class="cortext-data-view__new-row">New</button>
		` );

		expect(
			getCollectionSurfaceFocusTarget( root, {
				isTrulyEmpty: true,
				layoutType: 'table',
			} )
		).toHaveTextContent( 'New' );
	} );

	it( 'chooses Search when the collection is not truly empty', () => {
		const root = collectionRoot( `
			<div data-cortext-focus-region="search"><input type="search" /></div>
			<button class="cortext-data-view__new-row">New</button>
		` );

		expect(
			getCollectionSurfaceFocusTarget( root, {
				isTrulyEmpty: false,
				layoutType: 'table',
			} )
		).toHaveAttribute( 'type', 'search' );
	} );

	it( 'uses the first enabled view control when Search is unavailable', () => {
		const root = collectionRoot( `
			<div data-cortext-focus-region="view-controls">
				<button disabled>Layout</button>
				<button>View options</button>
			</div>
		` );

		expect(
			getCollectionSurfaceFocusTarget( root, {
				isTrulyEmpty: false,
				layoutType: 'table',
			} )
		).toHaveTextContent( 'View options' );
	} );

	it.each( [
		[
			'table',
			`<table><tbody><tr class="dataviews-view-table__row"><td><div class="cortext-title-cell"><div class="cortext-editable-cell__shell" role="button" tabindex="0">Title</div></div></td></tr></tbody></table>`,
			'.cortext-editable-cell__shell',
		],
		[
			'grid',
			`<div class="dataviews-view-grid"><div role="gridcell" class="dataviews-view-grid__card" tabindex="0">Card</div></div>`,
			'[role="gridcell"]',
		],
		[
			'list',
			`<div class="dataviews-view-list"><div class="dataviews-view-list__item" tabindex="0">List item</div></div>`,
			'.dataviews-view-list__item',
		],
	] )(
		'uses the first accessible %s row when no controls are available',
		( layoutType, markup, selector ) => {
			const root = collectionRoot( markup );

			expect(
				getCollectionSurfaceFocusTarget( root, {
					isTrulyEmpty: false,
					layoutType,
				} )
			).toBe( root.querySelector( selector ) );
		}
	);

	it( 'skips placeholders and the New card in grid view', () => {
		const root = collectionRoot( `
			<div class="dataviews-view-grid">
				<div role="gridcell" class="dataviews-view-grid__card dataviews-view-grid__placeholder"></div>
				<div role="gridcell" class="dataviews-view-grid__card cortext-data-view__new-row-gridcell"></div>
				<div role="gridcell" class="dataviews-view-grid__card" tabindex="0">First row</div>
			</div>
		` );

		expect(
			getCollectionSurfaceFocusTarget( root, {
				isTrulyEmpty: false,
				layoutType: 'grid',
			} )
		).toHaveTextContent( 'First row' );
	} );
} );

describe( 'isCollectionTrulyEmpty', () => {
	it( 'treats zero rows as empty only after loading, with no search or filters', () => {
		expect(
			isCollectionTrulyEmpty( {
				rowsResolved: true,
				totalItems: 0,
				view: {},
			} )
		).toBe( true );
		expect(
			isCollectionTrulyEmpty( {
				rowsResolved: true,
				totalItems: 0,
				view: { search: 'missing' },
			} )
		).toBe( false );
		expect(
			isCollectionTrulyEmpty( {
				rowsResolved: true,
				totalItems: 0,
				view: { filters: [ { field: 'status' } ] },
			} )
		).toBe( false );
		expect(
			isCollectionTrulyEmpty( {
				rowsResolved: false,
				totalItems: 0,
				view: {},
			} )
		).toBe( false );
	} );
} );

describe( 'isSurfaceFocusOriginCurrent', () => {
	it( 'returns true only while the origin is connected and focused', () => {
		const origin = document.createElement( 'button' );
		const other = document.createElement( 'button' );
		document.body.append( origin, other );
		origin.focus();

		expect( isSurfaceFocusOriginCurrent( origin ) ).toBe( true );
		other.focus();
		expect( isSurfaceFocusOriginCurrent( origin ) ).toBe( false );

		origin.remove();
		other.remove();
	} );
} );
