import { render } from '@testing-library/react';

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

	it( "maps Cortext's number to DataViews 'text' so decimals sort correctly", () => {
		expect( mapField( baseField( { type: 'number' } ) ).type ).toBe(
			'text'
		);
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

	it( "maps email to DataViews 'email'", () => {
		expect( mapField( baseField( { type: 'email' } ) ).type ).toBe(
			'email'
		);
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

	it( 'maps timestamps to DataViews datetime and names to text', () => {
		expect( byId( 'created_at' ).type ).toBe( 'datetime' );
		expect( byId( 'modified_at' ).type ).toBe( 'datetime' );
		expect( byId( 'created_by' ).type ).toBe( 'text' );
		expect( byId( 'modified_by' ).type ).toBe( 'text' );
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
