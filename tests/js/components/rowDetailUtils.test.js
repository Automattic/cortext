import {
	adjacentRowId,
	getRowDetailMode,
	isRowDetailFieldEditable,
	isValidNumberDraft,
	normalizeRowDetailMode,
	parseNumberPropertyValue,
	rowDetailDisplayFieldType,
	splitPropertyPatch,
	valueForField,
	withRowDetailMode,
} from '../../../src/components/rowDetailUtils';

describe( 'row detail mode helpers', () => {
	it( 'defaults missing or invalid modes to side', () => {
		expect( normalizeRowDetailMode() ).toBe( 'side' );
		expect( normalizeRowDetailMode( 'drawer' ) ).toBe( 'side' );
		expect( getRowDetailMode( {} ) ).toBe( 'side' );
	} );

	it( 'accepts the supported modes', () => {
		expect( normalizeRowDetailMode( 'side' ) ).toBe( 'side' );
		expect( normalizeRowDetailMode( 'modal' ) ).toBe( 'modal' );
		expect( normalizeRowDetailMode( 'full' ) ).toBe( 'full' );
	} );

	it( 'writes the normalized mode onto the view', () => {
		const view = { type: 'table', rowDetailMode: 'side' };
		expect( withRowDetailMode( view, 'side' ) ).toBe( view );
		expect( withRowDetailMode( view, 'full' ) ).toEqual( {
			type: 'table',
			rowDetailMode: 'full',
		} );
		expect( withRowDetailMode( view, 'unknown' ) ).toEqual( view );
	} );
} );

describe( 'adjacentRowId', () => {
	const rows = [ { id: 10 }, { id: 20 }, { id: 30 } ];

	it( 'steps through the active row order', () => {
		expect( adjacentRowId( rows, 20, -1 ) ).toBe( 10 );
		expect( adjacentRowId( rows, 20, 1 ) ).toBe( 30 );
	} );

	it( 'returns null at boundaries or for missing rows', () => {
		expect( adjacentRowId( rows, 10, -1 ) ).toBeNull();
		expect( adjacentRowId( rows, 30, 1 ) ).toBeNull();
		expect( adjacentRowId( rows, 99, 1 ) ).toBeNull();
		expect( adjacentRowId( [], 10, 1 ) ).toBeNull();
	} );

	it( 'matches row ids by string value', () => {
		expect( adjacentRowId( rows, '20', 1 ) ).toBe( 30 );
	} );
} );

describe( 'splitPropertyPatch', () => {
	it( 'separates title edits from meta edits and only sends the patch', () => {
		// Only the keys the user actually changed go through. Merging the
		// existing meta would mark every key edited and round-trip values
		// (including hydrated relations / rollups) back into REST on save.
		expect(
			splitPropertyPatch( {
				title: 'Next title',
				'field-1': 'Author',
				'field-2': true,
			} )
		).toEqual( {
			title: 'Next title',
			meta: {
				'field-1': 'Author',
				'field-2': true,
			},
		} );
	} );

	it( 'normalizes empty title values to an empty string', () => {
		expect( splitPropertyPatch( { title: null } ) ).toEqual( {
			title: '',
			meta: null,
		} );
	} );

	it( 'leaves meta null when only title changes', () => {
		expect( splitPropertyPatch( { title: 'Only title' } ) ).toEqual( {
			title: 'Only title',
			meta: null,
		} );
	} );
} );

describe( 'valueForField', () => {
	it( 'uses hydrated relation values for readonly relation properties', () => {
		const relation = [
			{
				id: 123,
				title: { raw: 'Target row', rendered: 'Target row' },
			},
		];

		expect(
			valueForField(
				{
					id: 'field-7',
					cortextFieldType: 'relation',
					editable: true,
				},
				{
					meta: { 'field-7': [ '123' ] },
					hydratedMeta: { 'field-7': relation },
				}
			)
		).toBe( relation );
	} );

	it( 'reads hydrated relation values while relation properties are editable', () => {
		const relation = [
			{
				id: 123,
				title: { raw: 'Target row', rendered: 'Target row' },
			},
		];

		expect(
			valueForField(
				{
					id: 'field-7',
					cortextFieldType: 'relation',
					editable: true,
					relatedCollectionId: 55,
				},
				{
					meta: { 'field-7': [ '123' ] },
					hydratedMeta: { 'field-7': relation },
					editContext: { collectionId: 44, rowId: 99 },
				}
			)
		).toBe( relation );
	} );

	it( 'uses hydrated rollup values for readonly rollup properties', () => {
		expect(
			valueForField(
				{
					id: 'field-8',
					cortextFieldType: 'rollup',
					editable: false,
				},
				{
					meta: { 'field-8': '' },
					hydratedMeta: { 'field-8': 42 },
				}
			)
		).toBe( 42 );
	} );

	it( 'keeps editable fields on raw meta so saves do not round-trip hydrated data', () => {
		expect(
			valueForField(
				{
					id: 'field-9',
					cortextFieldType: 'text',
					editable: true,
				},
				{
					meta: { 'field-9': 'raw value' },
					hydratedMeta: { 'field-9': 'display value' },
				}
			)
		).toBe( 'raw value' );
	} );
} );

describe( 'row detail field editing', () => {
	it( 'requires row, collection, and target context to edit relations', () => {
		const relationField = {
			id: 'field-7',
			cortextFieldType: 'relation',
			editable: true,
			relatedCollectionId: 55,
		};

		expect( isRowDetailFieldEditable( relationField ) ).toBe( false );
		expect(
			isRowDetailFieldEditable( relationField, {
				collectionId: 44,
				rowId: 99,
			} )
		).toBe( true );
		expect(
			isRowDetailFieldEditable(
				{ ...relationField, relatedCollectionId: undefined },
				{ collectionId: 44, rowId: 99 }
			)
		).toBe( false );
		expect(
			isRowDetailFieldEditable(
				{
					...relationField,
					relatedCollectionId: undefined,
					meta: { related_collection_id: '55' },
				},
				{ collectionId: 44, rowId: 99 }
			)
		).toBe( true );
	} );

	it( 'keeps existing editable field behavior', () => {
		expect(
			isRowDetailFieldEditable( {
				id: 'field-9',
				cortextFieldType: 'text',
				editable: true,
			} )
		).toBe( true );
		expect(
			isRowDetailFieldEditable( {
				id: 'field-10',
				cortextFieldType: 'rollup',
				editable: false,
			} )
		).toBe( false );
	} );
} );

describe( 'row detail display field types', () => {
	it( 'maps date range rollups to the range formatter', () => {
		expect(
			rowDetailDisplayFieldType( {
				id: 'field-10',
				cortextFieldType: 'rollup',
				rollupAggregator: 'date_range',
			} )
		).toBe( 'rollup-date-range' );
		expect(
			rowDetailDisplayFieldType( {
				id: 'field-11',
				cortextFieldType: 'rollup',
				cortextFormat: { rollup_aggregator: 'date_range' },
			} )
		).toBe( 'rollup-date-range' );
	} );

	it( 'keeps other field types unchanged', () => {
		expect(
			rowDetailDisplayFieldType( {
				id: 'field-9',
				cortextFieldType: 'number',
			} )
		).toBe( 'number' );
	} );
} );

describe( 'number property helpers', () => {
	it( 'allows numeric drafts a user can still finish typing', () => {
		expect( isValidNumberDraft( '' ) ).toBe( true );
		expect( isValidNumberDraft( '-' ) ).toBe( true );
		expect( isValidNumberDraft( '12.' ) ).toBe( true );
		expect( isValidNumberDraft( '.5' ) ).toBe( true );
		expect( isValidNumberDraft( '20a6' ) ).toBe( false );
		expect( isValidNumberDraft( '1.2.3' ) ).toBe( false );
	} );

	it( 'parses only empty or complete finite numbers for row meta', () => {
		expect( parseNumberPropertyValue( '' ) ).toEqual( {
			valid: true,
			complete: true,
			value: null,
		} );
		expect( parseNumberPropertyValue( '2026' ) ).toEqual( {
			valid: true,
			complete: true,
			value: 2026,
		} );
		expect( parseNumberPropertyValue( '12.' ) ).toEqual( {
			valid: true,
			complete: true,
			value: 12,
		} );
		expect( parseNumberPropertyValue( '-' ) ).toEqual( {
			valid: true,
			complete: false,
			value: null,
		} );
		expect( parseNumberPropertyValue( 'Infinity' ).valid ).toBe( false );
		expect( parseNumberPropertyValue( '20a6' ).valid ).toBe( false );
	} );
} );
