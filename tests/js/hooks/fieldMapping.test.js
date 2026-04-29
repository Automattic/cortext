import { elementsFromOptions, mapField } from '../../../src/hooks/fieldMapping';

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
		).toEqual( [
			{ value: 'open', label: 'Open', color: '#ffe2dd' },
		] );
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

describe( 'mapField', () => {
	const baseField = ( overrides ) => ( {
		id: 5,
		title: { rendered: 'Status', raw: 'Status' },
		meta: { type: 'text', ...( overrides ?? {} ) },
	} );

	it( "maps Cortext's number to DataViews 'text' so decimals sort correctly", () => {
		expect( mapField( baseField( { type: 'number' } ) ).type ).toBe( 'text' );
	} );

	it( "maps checkbox to DataViews 'boolean'", () => {
		expect( mapField( baseField( { type: 'checkbox' } ) ).type ).toBe(
			'boolean'
		);
	} );

	it( "maps multiselect to DataViews 'array' (not text + isMultiple)", () => {
		const mapped = mapField( baseField( { type: 'multiselect' } ) );
		expect( mapped.type ).toBe( 'array' );
		expect( mapped.isMultiple ).toBeUndefined();
	} );

	it( "maps email to DataViews 'email'", () => {
		expect( mapField( baseField( { type: 'email' } ) ).type ).toBe( 'email' );
	} );

	it( "maps url to DataViews 'text' (DataViews has no 'url' type)", () => {
		expect( mapField( baseField( { type: 'url' } ) ).type ).toBe( 'text' );
	} );

	it( 'maps date and datetime to DataViews datetime', () => {
		expect( mapField( baseField( { type: 'date' } ) ).type ).toBe(
			'datetime'
		);
		expect( mapField( baseField( { type: 'datetime' } ) ).type ).toBe(
			'datetime'
		);
	} );
} );
