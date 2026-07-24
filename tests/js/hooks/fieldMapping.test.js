import { render } from '@testing-library/react';
import { filterSortAndPaginate } from '@wordpress/dataviews/wp';

import {
	elementsFromOptions,
	mapField,
	parseFormat,
	systemFields,
} from '../../../src/hooks/fieldMapping';

describe( 'elementsFromOptions', () => {
	it( 'returns undefined for falsy input', () => {
		expect( elementsFromOptions( null ) ).toBeUndefined();
		expect( elementsFromOptions( '' ) ).toBeUndefined();
	} );

	it( 'returns undefined for malformed JSON strings', () => {
		expect( elementsFromOptions( '{not json' ) ).toBeUndefined();
	} );

	it( 'returns undefined when the parsed value is not an array', () => {
		expect( elementsFromOptions( '{}' ) ).toBeUndefined();
	} );

	it( 'parses string entries into matching value/label pairs', () => {
		expect( elementsFromOptions( [ 'open', 'closed' ] ) ).toEqual( [
			{ value: 'open', label: 'open' },
			{ value: 'closed', label: 'closed' },
		] );
	} );

	it( 'parses { value, label } entries', () => {
		expect(
			elementsFromOptions( [ { value: 'open', label: 'Open' } ] )
		).toEqual( [ { value: 'open', label: 'Open' } ] );
	} );

	it( 'carries color through when present', () => {
		expect(
			elementsFromOptions( [
				{ value: 'open', label: 'Open', color: '#ffe2dd' },
			] )
		).toEqual( [ { value: 'open', label: 'Open', color: '#ffe2dd' } ] );
	} );

	it( 'accepts a JSON string as input', () => {
		expect(
			elementsFromOptions(
				JSON.stringify( [
					{ value: 'a', label: 'A', color: '#ffe2dd' },
				] )
			)
		).toEqual( [ { value: 'a', label: 'A', color: '#ffe2dd' } ] );
	} );
} );

describe( 'parseFormat', () => {
	it( 'returns undefined for falsy input', () => {
		expect( parseFormat( null ) ).toBeUndefined();
		expect( parseFormat( '' ) ).toBeUndefined();
	} );

	it( 'returns undefined for malformed JSON', () => {
		expect( parseFormat( '{not json' ) ).toBeUndefined();
	} );

	it( 'returns undefined for non-objects', () => {
		expect( parseFormat( '"hello"' ) ).toBeUndefined();
		expect( parseFormat( '[1,2]' ) ).toBeUndefined();
	} );

	it( 'parses a JSON object', () => {
		expect( parseFormat( '{"style":"comma","decimals":2}' ) ).toEqual( {
			style: 'comma',
			decimals: 2,
		} );
	} );

	it( 'accepts an already-parsed object', () => {
		expect( parseFormat( { style: 'us', time: false } ) ).toEqual( {
			style: 'us',
			time: false,
		} );
	} );
} );

describe( 'mapField', () => {
	const baseField = ( overrides ) => ( {
		id: 5,
		title: { rendered: 'Status', raw: 'Status' },
		meta: { type: 'text', ...( overrides ?? {} ) },
	} );

	it( "maps Cortext's number and precision to DataViews 'number'", () => {
		const mapped = mapField(
			baseField( {
				type: 'number',
				number_format: '{"style":"comma","decimals":3}',
			} )
		);

		expect( mapped.type ).toBe( 'number' );
		expect( mapped.format ).toEqual( { decimals: 3 } );
		expect(
			mapped.getValueFormatted( {
				item: { 'field-5': 1234.5 },
				field: mapped,
			} )
		).toBe( '1,234.500' );
	} );

	it( 'keeps natural precision and no grouping when no number format is saved', () => {
		const mapped = mapField( baseField( { type: 'number' } ) );

		expect(
			mapped.getValueFormatted( {
				item: { 'field-5': 1234.5 },
				field: mapped,
			} )
		).toBe( '1234.5' );
	} );

	it( 'carries server query capabilities from the REST field record', () => {
		const mapped = mapField( {
			...baseField( { type: 'select' } ),
			cortext_capabilities: {
				sortable: true,
				filterable: true,
				operators: [ 'is', 'isAny' ],
			},
		} );

		expect( mapped.sortable ).toBe( true );
		expect( mapped.filterable ).toBe( true );
		expect( mapped.operators ).toEqual( [ 'is', 'isAny' ] );
	} );

	it( 'carries field descriptions and parsed defaults', () => {
		const mapped = mapField(
			baseField( {
				type: 'number',
				description: 'Expected invoice total.',
				default_value: '{"mode":"value","value":12.5}',
			} )
		);

		expect( mapped.description ).toBe( 'Expected invoice total.' );
		expect( mapped.cortextDefaultConfig ).toEqual( {
			mode: 'value',
			value: 12.5,
		} );
	} );

	it( 'configures DataViews text filters from UI-supported server operators', () => {
		const mapped = mapField( {
			...baseField( { type: 'text' } ),
			cortext_capabilities: {
				sortable: true,
				filterable: true,
				operators: [
					'is',
					'isNot',
					'contains',
					'notContains',
					'startsWith',
					'endsWith',
					'isEmpty',
				],
			},
		} );

		expect( mapped.filterBy ).toEqual( {
			operators: [
				'is',
				'isNot',
				'contains',
				'notContains',
				'startsWith',
			],
		} );
	} );

	it( 'configures DataViews number filters from UI-supported server operators', () => {
		const mapped = mapField( {
			...baseField( { type: 'number' } ),
			cortext_capabilities: {
				sortable: true,
				filterable: true,
				operators: [
					'is',
					'greaterThan',
					'lessThan',
					'between',
					'isEmpty',
				],
			},
		} );

		expect( mapped.filterBy ).toEqual( {
			operators: [ 'is', 'greaterThan', 'lessThan', 'between' ],
		} );
	} );

	it( 'configures DataViews date filters from UI-supported server operators', () => {
		const mapped = mapField( {
			...baseField( { type: 'date' } ),
			cortext_capabilities: {
				sortable: true,
				filterable: true,
				operators: [
					'on',
					'is',
					'before',
					'after',
					'between',
					'isEmpty',
				],
			},
		} );

		expect( mapped.filterBy ).toEqual( {
			operators: [ 'on', 'before', 'after', 'between' ],
		} );
	} );

	it( 'configures DataViews datetime filters without unsupported date-only range operators', () => {
		const mapped = mapField( {
			...baseField( { type: 'datetime' } ),
			cortext_capabilities: {
				sortable: true,
				filterable: true,
				operators: [
					'on',
					'is',
					'before',
					'after',
					'between',
					'isEmpty',
				],
			},
		} );

		expect( mapped.filterBy ).toEqual( {
			operators: [ 'on', 'before', 'after' ],
		} );
	} );

	it( 'configures DataViews option filters from UI-supported server operators', () => {
		const select = mapField( {
			...baseField( { type: 'select' } ),
			cortext_capabilities: {
				sortable: true,
				filterable: true,
				operators: [ 'is', 'isNot', 'isAny', 'isNone' ],
			},
		} );
		const multiselect = mapField( {
			...baseField( { type: 'multiselect' } ),
			cortext_capabilities: {
				sortable: false,
				filterable: true,
				operators: [ 'contains', 'notContains', 'isAny', 'isNone' ],
			},
		} );

		expect( select.filterBy ).toEqual( {
			operators: [ 'isAny', 'isNone' ],
		} );
		expect( multiselect.filterBy ).toEqual( {
			operators: [ 'isAny', 'isNone' ],
		} );
	} );

	it( 'defaults missing server query capabilities to unsupported', () => {
		const mapped = mapField( baseField( { type: 'text' } ) );

		expect( mapped.sortable ).toBe( false );
		expect( mapped.filterable ).toBe( false );
		expect( mapped.operators ).toEqual( [] );
	} );

	it( 'reads filter control data from top-level field ids', () => {
		const mapped = mapField( baseField( { type: 'text' } ) );

		expect( mapped.getValue( { item: { 'field-5': 'alpha' } } ) ).toBe(
			'alpha'
		);
		expect(
			mapped.getValue( { item: { meta: { 'field-5': 'beta' } } } )
		).toBe( 'beta' );
	} );

	it( 'sorts number field values numerically with empty values last', () => {
		const mapped = mapField( baseField( { type: 'number' } ) );

		expect( mapped.sort( '2', '10', 'asc' ) ).toBeLessThan( 0 );
		expect( mapped.sort( '2', '10', 'desc' ) ).toBeGreaterThan( 0 );
		expect( mapped.sort( '', '10', 'asc' ) ).toBeGreaterThan( 0 );
	} );

	it( "maps checkbox to DataViews 'boolean' values", () => {
		const mapped = mapField( baseField( { type: 'checkbox' } ) );

		expect( mapped.type ).toBe( 'boolean' );
		expect(
			mapped.getValue( { item: { meta: { 'field-5': '1' } } } )
		).toBe( true );
		expect( mapped.getValue( { item: { meta: { 'field-5': '' } } } ) ).toBe(
			false
		);
		expect(
			mapped.getValue( { item: { meta: { 'field-5': false } } } )
		).toBe( false );
	} );

	it( "maps multiselect to DataViews 'array' (not text + isMultiple)", () => {
		const mapped = mapField( baseField( { type: 'multiselect' } ) );
		expect( mapped.type ).toBe( 'array' );
		expect( mapped.isMultiple ).toBeUndefined();
	} );

	it( "maps relation to a non-sortable DataViews 'array'", () => {
		const mapped = mapField(
			baseField( {
				type: 'relation',
				related_collection_id: '9',
				relation_multiple: '0',
			} )
		);
		expect( mapped.type ).toBe( 'array' );
		expect( mapped.editable ).toBe( true );
		expect( mapped.enableSorting ).toBe( false );
		expect( mapped.filterBy ).toBe( false );
		expect( mapped.relatedCollectionId ).toBe( 9 );
		expect( mapped.relationMultiple ).toBe( false );
	} );

	it( "maps numeric rollups to read-only DataViews 'number' fields", () => {
		const mapped = mapField(
			baseField( {
				type: 'rollup',
				rollup_aggregator: 'sum',
				rollup_target_type: 'number',
				rollup_target_number_format: '{"decimals":1}',
			} )
		);
		expect( mapped.type ).toBe( 'number' );
		expect( mapped.format ).toEqual( { decimals: 1 } );
		expect( mapped.editable ).toBe( false );
		expect( mapped.enableSorting ).toBe( true );
		expect( mapped.rollupAggregator ).toBe( 'sum' );
		expect( mapped.sort( 2, 10, 'asc' ) ).toBeLessThan( 0 );
		expect(
			mapped.getValueFormatted( {
				item: { 'field-5': 12.34 },
				field: mapped,
			} )
		).toBe( '12.3' );
	} );

	it( 'sorts numeric rollups through the DataViews client pipeline', () => {
		const mapped = mapField(
			baseField( { type: 'rollup', rollup_aggregator: 'sum' } )
		);
		const items = [
			{ id: 'high', meta: { 'field-5': 10 } },
			{ id: 'low', meta: { 'field-5': 2 } },
		];
		const sort = ( direction ) =>
			filterSortAndPaginate(
				items,
				{ sort: { field: mapped.id, direction } },
				[ mapped ]
			).data.map( ( item ) => item.id );

		expect( sort( 'asc' ) ).toEqual( [ 'low', 'high' ] );
		expect( sort( 'desc' ) ).toEqual( [ 'high', 'low' ] );
	} );

	it( "maps latest rollups against a date target to read-only DataViews 'date' fields", () => {
		const mapped = mapField(
			baseField( {
				type: 'rollup',
				rollup_aggregator: 'latest',
				rollup_target_type: 'date',
			} )
		);
		expect( mapped.type ).toBe( 'date' );
		expect( mapped.editable ).toBe( false );
		expect( mapped.enableSorting ).toBe( true );
	} );

	it( "maps latest rollups against a datetime target to read-only DataViews 'datetime' fields", () => {
		const mapped = mapField(
			baseField( {
				type: 'rollup',
				rollup_aggregator: 'latest',
				rollup_target_type: 'datetime',
			} )
		);
		expect( mapped.type ).toBe( 'datetime' );
		expect( mapped.editable ).toBe( false );
		expect( mapped.enableSorting ).toBe( true );
	} );

	it( 'maps value-list rollups to read-only non-sortable fields', () => {
		const mapped = mapField(
			baseField( {
				type: 'rollup',
				rollup_aggregator: 'show_unique',
				rollup_target_type: 'select',
				rollup_target_options:
					'[{"value":"paid","label":"Paid","color":"green"}]',
			} )
		);
		expect( mapped.type ).toBe( 'array' );
		expect( mapped.editable ).toBe( false );
		expect( mapped.enableSorting ).toBe( false );
		expect( mapped.filterBy ).toBe( false );
	} );

	it( 'renders select value-list rollups as multiple chips', () => {
		const mapped = mapField(
			baseField( {
				type: 'rollup',
				rollup_aggregator: 'show_original',
				rollup_target_type: 'select',
				rollup_target_options:
					'[{"value":"paid","label":"Paid","color":"green"},{"value":"draft","label":"Draft","color":"gray"}]',
			} )
		);
		const { container } = render(
			mapped.render( {
				item: {
					meta: {
						'field-5': [ 'paid', 'draft' ],
					},
				},
			} )
		);

		expect( container.textContent ).toContain( 'Paid' );
		expect( container.textContent ).toContain( 'Draft' );
	} );

	it( 'maps date range rollups to read-only non-sortable text fields', () => {
		const mapped = mapField(
			baseField( {
				type: 'rollup',
				rollup_aggregator: 'date_range',
				rollup_target_type: 'date',
			} )
		);
		expect( mapped.type ).toBe( 'text' );
		expect( mapped.editable ).toBe( false );
		expect( mapped.enableSorting ).toBe( false );
		expect( mapped.filterBy ).toBe( false );
	} );

	it( 'renders date range rollups as start and end text', () => {
		const mapped = mapField(
			baseField( {
				type: 'rollup',
				rollup_aggregator: 'date_range',
				rollup_target_type: 'date',
				rollup_target_date_format: '{"style":"us"}',
			} )
		);
		const { container } = render(
			mapped.render( {
				item: {
					meta: {
						'field-5': {
							start: '2026-05-01',
							end: '2026-05-03',
						},
					},
				},
			} )
		);

		expect( container.textContent ).toContain( '05/01/2026 - 05/03/2026' );
	} );

	it( "maps email to DataViews 'email'", () => {
		expect( mapField( baseField( { type: 'email' } ) ).type ).toBe(
			'email'
		);
	} );

	it( "maps url to DataViews 'url'", () => {
		expect( mapField( baseField( { type: 'url' } ) ).type ).toBe( 'url' );
	} );

	it( 'maps date and datetime to matching DataViews date types', () => {
		expect( mapField( baseField( { type: 'date' } ) ).type ).toBe( 'date' );
		expect( mapField( baseField( { type: 'datetime' } ) ).type ).toBe(
			'datetime'
		);
	} );

	it( 'prefers title.raw over title.rendered for the column label', () => {
		// `the_title` filter encodes `&` as `&#038;` on `title.rendered`,
		// so we use the unfiltered string for the column header text.
		const mapped = mapField( {
			id: 5,
			title: { raw: 'A & B', rendered: 'A &#038; B' },
			meta: { type: 'text' },
		} );
		expect( mapped.label ).toBe( 'A & B' );
	} );

	it( 'preserves Cortext type and format metadata for table calculations', () => {
		const mapped = mapField(
			baseField( {
				type: 'number',
				number_format: '{"style":"comma","decimals":2}',
			} )
		);
		expect( mapped.cortextType ).toBe( 'number' );
		expect( mapped.cortextFormat ).toEqual( {
			style: 'comma',
			decimals: 2,
		} );
	} );
} );

describe( 'systemFields', () => {
	const fields = systemFields();
	const byId = ( id ) => fields.find( ( f ) => f.id === id );

	it( 'returns the four system fields with stable ids', () => {
		expect( fields ).toHaveLength( 4 );
		expect( fields.map( ( f ) => f.id ) ).toEqual( [
			'created_at',
			'created_by',
			'modified_at',
			'modified_by',
		] );
	} );

	it( 'marks every system field as not editable', () => {
		fields.forEach( ( f ) => expect( f.editable ).toBe( false ) );
	} );

	it( 'enables sorting only on the timestamp fields', () => {
		expect( byId( 'created_at' ).enableSorting ).toBe( true );
		expect( byId( 'modified_at' ).enableSorting ).toBe( true );
		expect( byId( 'created_by' ).enableSorting ).toBe( false );
		expect( byId( 'modified_by' ).enableSorting ).toBe( false );
	} );

	it( 'marks only timestamp system fields as server-sortable', () => {
		expect( byId( 'created_at' ).sortable ).toBe( true );
		expect( byId( 'modified_at' ).sortable ).toBe( true );
		expect( byId( 'created_by' ).sortable ).toBe( false );
		expect( byId( 'modified_by' ).sortable ).toBe( false );
		fields.forEach( ( f ) => {
			expect( f.filterable ).toBe( false );
			expect( f.operators ).toEqual( [] );
		} );
	} );

	it( 'maps timestamps to DataViews datetime and names to text', () => {
		expect( byId( 'created_at' ).type ).toBe( 'datetime' );
		expect( byId( 'modified_at' ).type ).toBe( 'datetime' );
		expect( byId( 'created_by' ).type ).toBe( 'text' );
		expect( byId( 'modified_by' ).type ).toBe( 'text' );
	} );

	it( 'renders system icons in their table headers', () => {
		const { container } = render( byId( 'modified_at' ).header );
		expect(
			container.querySelector(
				'.cortext-column-header-system-icon[data-cortext-system-field="modified_at"]'
			)
		).toBeInTheDocument();
		expect( container.textContent ).toContain( 'Last edited' );
	} );

	it( 'reads each value from the row payload', () => {
		const item = {
			created_at: '2026-04-30T09:48:54+00:00',
			modified_at: '2026-04-30T10:00:00+00:00',
			created_by: 'Ada Lovelace',
			modified_by: 'Grace Hopper',
		};
		expect( byId( 'created_at' ).getValue( { item } ) ).toBe(
			'2026-04-30T09:48:54+00:00'
		);
		expect( byId( 'modified_at' ).getValue( { item } ) ).toBe(
			'2026-04-30T10:00:00+00:00'
		);
		expect( byId( 'created_by' ).getValue( { item } ) ).toBe(
			'Ada Lovelace'
		);
		expect( byId( 'modified_by' ).getValue( { item } ) ).toBe(
			'Grace Hopper'
		);
	} );

	it( 'returns null when the row is missing the value', () => {
		fields.forEach( ( f ) =>
			expect( f.getValue( { item: {} } ) ).toBeNull()
		);
	} );

	it( 'renders names as plain text', () => {
		const Render = byId( 'created_by' ).render;
		const { container } = render(
			<Render item={ { created_by: 'Ada Lovelace' } } />
		);
		expect( container.textContent ).toBe( 'Ada Lovelace' );
	} );

	it( 'renders empty when the value is missing', () => {
		const Render = byId( 'modified_by' ).render;
		const { container } = render( <Render item={ {} } /> );
		expect( container.textContent ).toBe( '' );
	} );

	it( 'renders timestamps as a non-empty formatted string', () => {
		const Render = byId( 'created_at' ).render;
		const { container } = render(
			<Render item={ { created_at: '2026-04-30T09:48:54+00:00' } } />
		);
		// We don't assert the exact format (locale-dependent), only that
		// something formatted comes out and the empty branch isn't hit.
		expect( container.textContent.length ).toBeGreaterThan( 0 );
		expect( container.textContent ).not.toBe( '2026-04-30T09:48:54+00:00' );
	} );
} );
