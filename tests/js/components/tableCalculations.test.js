import {
	calculateField,
	calculationOptionsForField,
	isEmptyValue,
	sanitizeCalculations,
	withColumnCalculation,
} from '../../../src/components/tableCalculations';

const field = ( overrides = {} ) => ( {
	id: 'field-1',
	label: 'Field',
	type: 'text',
	cortextType: 'text',
	getValue: ( { item } ) => item.value,
	...overrides,
} );

describe( 'isEmptyValue', () => {
	it( 'treats nullish, empty string, and empty arrays as empty', () => {
		expect( isEmptyValue( null ) ).toBe( true );
		expect( isEmptyValue( undefined ) ).toBe( true );
		expect( isEmptyValue( '' ) ).toBe( true );
		expect( isEmptyValue( [] ) ).toBe( true );
	} );

	it( 'keeps false and zero as non-empty values', () => {
		expect( isEmptyValue( false ) ).toBe( false );
		expect( isEmptyValue( 0 ) ).toBe( false );
	} );
} );

describe( 'calculationOptionsForField', () => {
	it( 'allows only count and percent calculations for text-like fields', () => {
		expect( calculationOptionsForField( field() ) ).toEqual( [
			'count',
			'countValues',
			'countUnique',
			'empty',
			'notEmpty',
			'percentEmpty',
			'percentNotEmpty',
		] );
	} );

	it( 'allows numeric summary calculations for numbers', () => {
		expect(
			calculationOptionsForField(
				field( { type: 'text', cortextType: 'number' } )
			)
		).toEqual( [
			'count',
			'countValues',
			'countUnique',
			'empty',
			'notEmpty',
			'percentEmpty',
			'percentNotEmpty',
			'sum',
			'average',
			'median',
			'min',
			'max',
			'range',
		] );
	} );

	it( 'keeps count options for select fields', () => {
		expect(
			calculationOptionsForField(
				field( { type: 'text', cortextType: 'select' } )
			)
		).toEqual( [
			'count',
			'countValues',
			'countUnique',
			'empty',
			'notEmpty',
			'percentEmpty',
			'percentNotEmpty',
		] );
	} );

	it( 'limits multiselect fields to row-presence calculations', () => {
		expect(
			calculationOptionsForField(
				field( { type: 'array', cortextType: 'multiselect' } )
			)
		).toEqual( [
			'count',
			'empty',
			'notEmpty',
			'percentEmpty',
			'percentNotEmpty',
		] );
	} );

	it( 'limits checkbox fields to counting rows', () => {
		expect(
			calculationOptionsForField(
				field( { type: 'boolean', cortextType: 'checkbox' } )
			)
		).toEqual( [ 'count' ] );
	} );
} );

describe( 'calculateField', () => {
	it( 'counts all rows, empty values, and populated values', () => {
		const rows = [ { value: '' }, { value: 0 }, { value: false } ];
		expect( calculateField( rows, field(), 'count' ) ).toBe( '3' );
		expect( calculateField( rows, field(), 'countValues' ) ).toBe( '2' );
		expect( calculateField( rows, field(), 'empty' ) ).toBe( '1' );
		expect( calculateField( rows, field(), 'notEmpty' ) ).toBe( '2' );
	} );

	it( 'counts unique populated values and formats empty percentages', () => {
		const rows = [
			{ value: 'Alpha' },
			{ value: 'Alpha' },
			{ value: 'Beta' },
			{ value: '' },
		];
		expect( calculateField( rows, field(), 'countUnique' ) ).toBe( '2' );
		expect( calculateField( rows, field(), 'percentEmpty' ) ).toBe( '25%' );
		expect( calculateField( rows, field(), 'percentNotEmpty' ) ).toBe(
			'75%'
		);
	} );

	it( 'sums and averages finite numeric values only', () => {
		const numberField = field( { cortextType: 'number' } );
		const rows = [
			{ value: 10 },
			{ value: '20' },
			{ value: '' },
			{ value: 'not a number' },
		];
		expect( calculateField( rows, numberField, 'sum' ) ).toBe( '30' );
		expect( calculateField( rows, numberField, 'average' ) ).toBe( '15' );
	} );

	it( 'finds median and range for finite numeric values only', () => {
		const numberField = field( { cortextType: 'number' } );
		const rows = [
			{ value: 10 },
			{ value: '2' },
			{ value: '' },
			{ value: 8 },
			{ value: 'not a number' },
			{ value: 4 },
		];
		expect( calculateField( rows, numberField, 'median' ) ).toBe( '6' );
		expect( calculateField( rows, numberField, 'range' ) ).toBe( '8' );
	} );

	it( 'finds min and max for numbers', () => {
		const numberField = field( { cortextType: 'number' } );
		const rows = [ { value: 4 }, { value: 10 }, { value: 2 } ];
		expect( calculateField( rows, numberField, 'min' ) ).toBe( '2' );
		expect( calculateField( rows, numberField, 'max' ) ).toBe( '10' );
	} );

	it( 'does not calculate min or max for text fields', () => {
		const rows = [
			{ value: 'Gamma' },
			{ value: 'Alpha' },
			{ value: 'Beta' },
		];
		expect( calculateField( rows, field(), 'min' ) ).toBe( '' );
		expect( calculateField( rows, field(), 'max' ) ).toBe( '' );
	} );

	it( 'finds min and max for dates', () => {
		const dateField = field( {
			type: 'datetime',
			cortextType: 'date',
			cortextFormat: { style: 'us' },
		} );
		const rows = [
			{ value: '2026-03-03' },
			{ value: '2026-01-02' },
			{ value: '2026-02-01' },
		];
		expect( calculateField( rows, dateField, 'min' ) ).toBe( '01/02/2026' );
		expect( calculateField( rows, dateField, 'max' ) ).toBe( '03/03/2026' );
	} );

	it( 'returns blank when a non-count calculation has no comparable values', () => {
		const rows = [ { value: '' }, { value: null } ];
		expect( calculateField( rows, field(), 'min' ) ).toBe( '' );
		expect(
			calculateField( rows, field( { cortextType: 'number' } ), 'median' )
		).toBe( '' );
		expect(
			calculateField( rows, field( { cortextType: 'number' } ), 'range' )
		).toBe( '' );
	} );
} );

describe( 'sanitizeCalculations', () => {
	it( 'keeps valid entries and drops stale or disallowed entries', () => {
		expect(
			sanitizeCalculations(
				{
					'field-1': 'sum',
					'field-2': 'sum',
					'field-3': 'count',
					'field-4': 'countUnique',
					'field-5': 'countUnique',
					'field-6': 'countUnique',
					__add_field: 'count',
				},
				[
					field( { id: 'field-1', cortextType: 'number' } ),
					field( { id: 'field-2', cortextType: 'text' } ),
					field( { id: 'field-4', cortextType: 'select' } ),
					field( { id: 'field-5', cortextType: 'multiselect' } ),
					field( { id: 'field-6', cortextType: 'checkbox' } ),
				]
			)
		).toEqual( {
			'field-1': 'sum',
			'field-4': 'countUnique',
		} );
	} );
} );

describe( 'withColumnCalculation', () => {
	it( 'sets and clears calculations on the view object', () => {
		const view = { type: 'table' };
		const withSum = withColumnCalculation( view, 'field-1', 'sum' );
		expect( withSum.calculations ).toEqual( { 'field-1': 'sum' } );
		expect(
			withColumnCalculation( withSum, 'field-1', null ).calculations
		).toBeUndefined();
	} );
} );
