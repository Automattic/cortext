import {
	adaptViewForDataViews,
	mergeDataViewsChange,
} from '../../../src/components/dataViewAdapter';

describe( 'dataViewAdapter', () => {
	const canonicalView = {
		type: 'table',
		fields: [ 'title', 'field-1', 'field-2' ],
		sort: { field: 'field-1', direction: 'asc' },
		filters: [ { field: 'field-2', operator: 'is', value: 'open' } ],
		search: 'needle',
		page: 2,
		perPage: 25,
		layout: { density: 'compact', styles: { title: { width: 280 } } },
		layoutByType: {
			table: { density: 'compact', styles: { title: { width: 280 } } },
			grid: { previewSize: 290, badgeFields: [ 'field-2' ] },
			list: {},
		},
		fieldsByType: {
			grid: [],
			list: [],
		},
		rowDetailMode: 'side',
	};

	it( 'keeps the table view shape canonical for DataViews', () => {
		const view = adaptViewForDataViews( canonicalView );

		expect( view.type ).toBe( 'table' );
		expect( view.titleField ).toBe( 'title' );
		expect( view.showTitle ).toBe( false );
		expect( view.fields ).toEqual( [ 'title', 'field-1', 'field-2' ] );
		expect( view.layout ).toEqual( {
			density: 'compact',
			styles: { title: { minWidth: 80, width: 280 } },
		} );
		expect( view.mediaField ).toBeUndefined();
	} );

	it( 'uses titleField for grid without inheriting table fields', () => {
		const view = adaptViewForDataViews( {
			...canonicalView,
			type: 'grid',
			layout: canonicalView.layoutByType.grid,
		} );

		expect( view.type ).toBe( 'grid' );
		expect( view.titleField ).toBe( 'title' );
		expect( view.mediaField ).toBe( 'cover' );
		expect( view.fields ).toEqual( [] );
		expect( view.layout ).toEqual( {
			previewSize: 290,
			badgeFields: [ 'field-2' ],
		} );
	} );

	it( 'uses titleField for list without inheriting table fields', () => {
		const view = adaptViewForDataViews( {
			...canonicalView,
			type: 'list',
			layout: canonicalView.layoutByType.list,
			fieldsByType: { grid: [], list: [ 'field-2' ] },
		} );

		expect( view.type ).toBe( 'list' );
		expect( view.titleField ).toBe( 'title' );
		expect( view.fields ).toEqual( [ 'field-2' ] );
	} );

	it( 'round-trips table to grid to table without losing layout buckets', () => {
		const gridRenderView = adaptViewForDataViews( {
			...canonicalView,
			type: 'grid',
			layout: canonicalView.layoutByType.grid,
		} );
		const gridCanonical = mergeDataViewsChange(
			canonicalView,
			gridRenderView
		);
		const tableCanonical = mergeDataViewsChange( gridCanonical, {
			...gridCanonical,
			type: 'table',
			fields: [ 'title', 'field-1', 'field-2' ],
			layout: { density: 'balanced' },
		} );

		expect( tableCanonical.type ).toBe( 'table' );
		expect( tableCanonical.layout ).toEqual( {
			density: 'compact',
			styles: { title: { width: 280 } },
		} );
		expect( tableCanonical.layoutByType.grid ).toEqual( {
			previewSize: 290,
			badgeFields: [ 'field-2' ],
		} );
		expect( tableCanonical.layoutByType.table ).toEqual( {
			density: 'compact',
			styles: { title: { width: 280 } },
		} );
		expect( tableCanonical.fields ).toEqual( [
			'title',
			'field-1',
			'field-2',
		] );
		expect( tableCanonical.fieldsByType ).toEqual( {
			grid: [],
			list: [],
		} );
	} );

	it( 'does not copy table fields into grid when switching layouts', () => {
		const gridCanonical = mergeDataViewsChange( canonicalView, {
			type: 'grid',
			fields: [ 'title', 'field-1', 'field-2' ],
			layout: {},
		} );

		expect( gridCanonical.type ).toBe( 'grid' );
		expect( gridCanonical.fields ).toEqual( [
			'title',
			'field-1',
			'field-2',
		] );
		expect( gridCanonical.fieldsByType.grid ).toEqual( [] );
	} );

	it( 'stores grid field changes in the grid bucket only', () => {
		const gridCanonical = mergeDataViewsChange(
			{
				...canonicalView,
				type: 'grid',
				layout: canonicalView.layoutByType.grid,
			},
			{
				...adaptViewForDataViews( {
					...canonicalView,
					type: 'grid',
					layout: canonicalView.layoutByType.grid,
				} ),
				fields: [ 'field-2', 'title', 'field-2' ],
			}
		);

		expect( gridCanonical.fields ).toEqual( [
			'title',
			'field-1',
			'field-2',
		] );
		expect( gridCanonical.fieldsByType.grid ).toEqual( [ 'field-2' ] );
	} );

	it( 'updates the active layout bucket when the type does not change', () => {
		const tableCanonical = mergeDataViewsChange( canonicalView, {
			...canonicalView,
			layout: { density: 'balanced' },
		} );

		expect( tableCanonical.layout ).toEqual( { density: 'balanced' } );
		expect( tableCanonical.layoutByType.table ).toEqual( {
			density: 'balanced',
		} );
	} );

	it( 'preserves query state and stores list fields outside table columns', () => {
		const previousListView = {
			...canonicalView,
			type: 'list',
			layout: canonicalView.layoutByType.list,
		};
		const listCanonical = mergeDataViewsChange( previousListView, {
			...adaptViewForDataViews( previousListView ),
			fields: [ 'field-2' ],
		} );

		expect( listCanonical.fields ).toEqual( [
			'title',
			'field-1',
			'field-2',
		] );
		expect( listCanonical.fieldsByType.list ).toEqual( [ 'field-2' ] );
		expect( listCanonical.sort ).toEqual( canonicalView.sort );
		expect( listCanonical.filters ).toEqual( canonicalView.filters );
		expect( listCanonical.search ).toBe( 'needle' );
		expect( listCanonical.page ).toBe( 2 );
		expect( listCanonical.perPage ).toBe( 25 );
		expect( listCanonical.titleField ).toBeUndefined();
	} );

	it( 'preserves query state when DataViews emits a partial view change', () => {
		const tableCanonical = mergeDataViewsChange( canonicalView, {
			type: 'table',
			layout: { density: 'comfortable' },
		} );

		expect( tableCanonical.sort ).toEqual( canonicalView.sort );
		expect( tableCanonical.filters ).toEqual( canonicalView.filters );
		expect( tableCanonical.search ).toBe( 'needle' );
		expect( tableCanonical.page ).toBe( 2 );
		expect( tableCanonical.perPage ).toBe( 25 );
	} );
} );
