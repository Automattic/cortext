import {
	addNamedView,
	createDefaultView,
	createDefaultViewConfig,
	deleteActiveView,
	duplicateActiveView,
	getActiveView,
	isInitialDefaultViewConfig,
	moveActiveView,
	normalizeViewConfig,
	normalizeViewConfigForFields,
	prepareViewConfigForStorage,
	renameActiveView,
	setActiveView,
	shouldSeedViewConfigFromLegacyView,
	updateActiveView,
	viewConfigsEqual,
} from '../../../src/components/collectionViewConfig';
import { TITLE_FIELD_ID } from '../../../src/components/dataViewColumns';

// PHP's json encoding writes empty associative arrays as `[]`.
function asPhpResponse( viewConfig ) {
	return JSON.parse( JSON.stringify( viewConfig ).replace( /\{\}/g, '[]' ) );
}

// GET /cortext/v1/collections/{id}/views for a collection with no saved views.
const ENDPOINT_DEFAULT = {
	default_view: {
		type: 'table',
		fields: [],
		sort: null,
		filters: [],
		calculations: [],
		perPage: 25,
		layout: { density: 'compact' },
		rowDetailMode: 'side',
	},
	default_layouts: { table: { density: 'compact' }, grid: [], list: [] },
	active_view: 'default',
	view_list: [
		{
			slug: 'default',
			title: 'Table',
			view: {
				type: 'table',
				fields: [],
				sort: null,
				filters: [],
				calculations: [],
				perPage: 25,
				layout: { density: 'compact' },
				rowDetailMode: 'side',
			},
		},
	],
};

describe( 'collection view config', () => {
	it( 'wraps a legacy single view into a Gutenberg-style view config', () => {
		const legacyView = createDefaultView( {
			search: 'books',
			rowDetailMode: 'modal',
		} );
		const viewConfig = normalizeViewConfig( null, { legacyView } );

		expect( viewConfig.active_view ).toBe( 'default' );
		expect( viewConfig.default_view.search ).toBeUndefined();
		expect( viewConfig.view_list ).toHaveLength( 1 );
		expect( viewConfig.view_list[ 0 ].title ).toBe( 'Table' );
		expect( viewConfig.view_list[ 0 ].view.search ).toBeUndefined();
		expect( viewConfig.view_list[ 0 ].view.rowDetailMode ).toBe( 'modal' );
		expect( viewConfig.default_view ).toEqual(
			createDefaultViewConfig().default_view
		);
	} );

	it( 'keeps settings cleared from a view seeded by a legacy view', () => {
		const legacyView = createDefaultView( {
			calculations: { 'field-1': 'sum' },
			layout: {
				density: 'compact',
				styles: { 'field-1': { width: 300 } },
			},
		} );
		const viewConfig = normalizeViewConfig( null, { legacyView } );
		const cleared = { ...getActiveView( viewConfig ) };
		delete cleared.calculations;

		const next = updateActiveView( viewConfig, cleared );

		expect( getActiveView( viewConfig ).calculations ).toEqual( {
			'field-1': 'sum',
		} );
		expect( viewConfigsEqual( next, viewConfig ) ).toBe( false );
		expect( getActiveView( next ).calculations ).toEqual( {} );
		expect(
			getActiveView( addNamedView( viewConfig ) ).layout.styles
		).toBeUndefined();
	} );

	it( 'detects the initial endpoint default view config', () => {
		expect( isInitialDefaultViewConfig( ENDPOINT_DEFAULT ) ).toBe( true );
	} );

	it( 'reads empty PHP arrays as the empty objects they stand for', () => {
		const stored = prepareViewConfigForStorage(
			addNamedView( createDefaultViewConfig() )
		);
		const response = asPhpResponse( stored );
		const normalized = normalizeViewConfig( response );

		expect( response.view_list[ 0 ].view.calculations ).toEqual( [] );
		expect( normalized.view_list[ 0 ].view.calculations ).toEqual( {} );
		expect( normalized.default_layouts.grid ).toEqual( {} );
		expect( normalized.view_list[ 0 ].view.layoutByType.list ).toEqual(
			{}
		);
		expect( viewConfigsEqual( normalized, stored ) ).toBe( true );
		// The surface saves whatever this pass changes, so a response it
		// still rewrites would be saved again on every round trip.
		const reconciled = normalizeViewConfigForFields(
			normalized,
			new Set( [ TITLE_FIELD_ID ] ),
			{
				ensureTitle: false,
				fields: [ { id: TITLE_FIELD_ID, cortextType: 'title' } ],
			}
		);
		expect( JSON.stringify( reconciled ) ).toBe(
			JSON.stringify( normalized )
		);
	} );

	it( 'seeds the owner config from a customized legacy view only for the initial default', () => {
		const endpointDefault = ENDPOINT_DEFAULT;
		const legacyView = createDefaultView( {
			fields: [ 'title', 'field-1' ],
			sort: { field: 'field-1', direction: 'asc' },
			rowDetailMode: 'modal',
		} );
		const storedViewConfig = renameActiveView(
			createDefaultViewConfig(),
			'Saved'
		);

		expect(
			shouldSeedViewConfigFromLegacyView( endpointDefault, legacyView )
		).toBe( true );
		expect(
			shouldSeedViewConfigFromLegacyView(
				endpointDefault,
				createDefaultView()
			)
		).toBe( false );
		expect(
			shouldSeedViewConfigFromLegacyView( storedViewConfig, legacyView )
		).toBe( false );
	} );

	it( 'falls back to the first view when the active slug is stale', () => {
		const viewConfig = normalizeViewConfig( {
			active_view: 'missing',
			view_list: [
				{ slug: 'alpha', title: 'Alpha', view: createDefaultView() },
				{ slug: 'beta', title: 'Beta', view: createDefaultView() },
			],
		} );

		expect( viewConfig.active_view ).toBe( 'alpha' );
	} );

	it( 'updates only the active view config', () => {
		const viewConfig = normalizeViewConfig( {
			active_view: 'beta',
			view_list: [
				{ slug: 'alpha', title: 'Alpha', view: createDefaultView() },
				{ slug: 'beta', title: 'Beta', view: createDefaultView() },
			],
		} );

		const next = updateActiveView(
			viewConfig,
			createDefaultView( { search: 'active only' } )
		);

		expect( next.view_list[ 0 ].view.search ).toBeUndefined();
		expect( next.view_list[ 1 ].view.search ).toBeUndefined();
		expect( getActiveView( next ).fields ).toEqual( [] );
	} );

	it( 'adds a fresh view and selects it', () => {
		const next = addNamedView( createDefaultViewConfig() );

		expect( next.view_list ).toHaveLength( 2 );
		expect( next.active_view ).toBe( 'view-1' );
		expect( getActiveView( next ).fields ).toEqual( [] );
	} );

	it( 'renames the active view', () => {
		const next = renameActiveView( createDefaultViewConfig(), 'Planning' );

		expect( next.view_list[ 0 ].title ).toBe( 'Planning' );
	} );

	it( 'duplicates the active view after the source and selects the copy', () => {
		const viewConfig = updateActiveView(
			createDefaultViewConfig(),
			createDefaultView( { rowDetailMode: 'modal' } )
		);
		const next = duplicateActiveView( viewConfig );

		expect( next.view_list.map( ( view ) => view.title ) ).toEqual( [
			'Table',
			'Table copy',
		] );
		expect( next.active_view ).toBe( 'view-1' );
		expect( getActiveView( next ).rowDetailMode ).toBe( 'modal' );
		expect( next.view_list[ 0 ].view ).not.toBe( next.view_list[ 1 ].view );
	} );

	it( 'deletes the active view and selects the nearest remaining view', () => {
		const viewConfig = addNamedView(
			addNamedView( createDefaultViewConfig() )
		);
		const next = deleteActiveView( viewConfig );

		expect( next.view_list.map( ( view ) => view.slug ) ).toEqual( [
			'default',
			'view-1',
		] );
		expect( next.active_view ).toBe( 'view-1' );
	} );

	it( 'does not delete the final view', () => {
		const viewConfig = createDefaultViewConfig();
		const next = deleteActiveView( viewConfig );

		expect( next.view_list ).toHaveLength( 1 );
		expect( next.active_view ).toBe( 'default' );
	} );

	it( 'moves the active view in the ordered list', () => {
		const viewConfig = setActiveView(
			addNamedView( addNamedView( createDefaultViewConfig() ) ),
			'view-1'
		);
		const next = moveActiveView( viewConfig, 1 );

		expect( next.view_list.map( ( view ) => view.slug ) ).toEqual( [
			'default',
			'view-2',
			'view-1',
		] );
		expect( next.active_view ).toBe( 'view-1' );
	} );

	it( 'strips runtime query state before storage', () => {
		const next = prepareViewConfigForStorage(
			updateActiveView(
				createDefaultViewConfig(),
				createDefaultView( {
					page: 3,
					search: 'draft',
					rowDetailMode: 'full',
				} )
			)
		);

		expect( next.view_list[ 0 ].view.page ).toBeUndefined();
		expect( next.view_list[ 0 ].view.search ).toBeUndefined();
		expect( next.view_list[ 0 ].view.rowDetailMode ).toBe( 'full' );
	} );

	it( 'treats runtime-only page and search changes as the same stored config', () => {
		const viewConfig = updateActiveView(
			createDefaultViewConfig(),
			createDefaultView( { fields: [ 'title' ] } )
		);
		const runtimeOnly = {
			...viewConfig,
			view_list: [
				{
					...viewConfig.view_list[ 0 ],
					view: {
						...viewConfig.view_list[ 0 ].view,
						page: 4,
						search: 'runtime',
					},
				},
			],
		};

		expect( viewConfigsEqual( viewConfig, runtimeOnly ) ).toBe( true );
	} );

	it( 'normalizes all view configs against the live fields', () => {
		const viewConfig = normalizeViewConfig( {
			active_view: 'default',
			view_list: [
				{
					slug: 'default',
					title: 'One',
					view: createDefaultView( {
						fields: [ TITLE_FIELD_ID, 'field-1', 'field-dead' ],
						sort: { field: 'field-dead', direction: 'asc' },
						filters: [
							{ field: 'field-1', operator: 'is', value: 'x' },
							{ field: 'field-dead', operator: 'is', value: 'y' },
						],
						groupByField: 'field-dead',
						groupBy: { field: 'field-dead' },
					} ),
				},
				{
					slug: 'view-1',
					title: 'Two',
					view: createDefaultView( {
						fields: [ TITLE_FIELD_ID, 'field-dead' ],
						layout: {
							styles: {
								'field-dead': { width: 120 },
							},
						},
						rowDetailMode: 'full',
					} ),
				},
			],
		} );

		const next = normalizeViewConfigForFields(
			viewConfig,
			new Set( [ TITLE_FIELD_ID, 'field-1' ] ),
			{
				fields: [
					{ id: TITLE_FIELD_ID, cortextType: 'title' },
					{ id: 'field-1', cortextType: 'text' },
				],
			}
		);

		expect( next.view_list[ 0 ].view.fields ).toEqual( [
			TITLE_FIELD_ID,
			'field-1',
		] );
		expect( next.view_list[ 0 ].view.sort ).toBeNull();
		expect( next.view_list[ 0 ].view.filters ).toEqual( [
			{ field: 'field-1', operator: 'is', value: 'x' },
		] );
		expect( next.view_list[ 0 ].view.groupByField ).toBeUndefined();
		expect( next.view_list[ 0 ].view.groupBy ).toBeUndefined();
		expect( next.view_list[ 1 ].view.fields ).toEqual( [ TITLE_FIELD_ID ] );
		expect( next.view_list[ 1 ].view.layout.styles ).toBeUndefined();
		expect( next.view_list[ 1 ].view.rowDetailMode ).toBe( 'full' );
	} );
} );
