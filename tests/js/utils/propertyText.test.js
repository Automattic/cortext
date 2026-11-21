/**
 * Runs the cases shared with `tests/php/test-fields-property-text.php`.
 */
import fixture from '../../fixtures/property-text.json';
import {
	formatPropertyText,
	propertyKey,
	propertyText,
	propertyTextConfig,
} from '../../../src/utils/propertyText';
import { mapField, systemFields } from '../../../src/hooks/fieldMapping';

function normalizeSpaces( text ) {
	return text.replace( / /g, ' ' );
}

describe( 'formatPropertyText', () => {
	it.each( fixture.cases.map( ( testCase ) => [ testCase.name, testCase ] ) )(
		'%s',
		( _name, { config, value, expected } ) => {
			expect(
				normalizeSpaces( formatPropertyText( value, config ) )
			).toBe( expected );
		}
	);
} );

describe( 'propertyText', () => {
	const numberField = mapField( {
		id: 12,
		title: { raw: 'Pages' },
		meta: { type: 'number', number_format: '{"style":"comma"}' },
	} );

	it( 'reads the edited value and formats it', () => {
		const record = { meta: { 'field-12': 1200 } };

		expect( propertyText( numberField, record ) ).toBe( '1,200' );
		expect( propertyText( numberField, record, { raw: true } ) ).toBe(
			'1200'
		);
	} );

	it( 'reads computed values from hydrated meta', () => {
		const rollup = mapField( {
			id: 13,
			title: { raw: 'Total' },
			meta: { type: 'rollup', rollup_aggregator: 'sum' },
		} );

		expect( propertyTextConfig( rollup ).type ).toBe( 'number' );
		expect(
			propertyText( rollup, {
				meta: { 'field-13': 'stale' },
				cortext_hydrated_meta: { 'field-13': 42 },
			} )
		).toBe( '42' );
	} );

	it( 'uses the formula result type', () => {
		const formula = mapField( {
			id: 14,
			title: { raw: 'Done' },
			meta: { type: 'formula', formula_result_type: 'checkbox' },
		} );

		expect(
			propertyText( formula, {
				cortext_hydrated_meta: { 'field-14': true },
			} )
		).toBe( 'Yes' );
	} );

	it( 'reads system fields from the record', () => {
		const createdBy = systemFields().find(
			( field ) => field.id === 'created_by'
		);

		expect( propertyText( createdBy, { created_by: 'Ada' } ) ).toBe(
			'Ada'
		);
		expect( propertyText( createdBy, {} ) ).toBe( '' );
	} );

	it( 'keys custom fields by post ID and system fields by name', () => {
		expect( propertyKey( numberField ) ).toBe( '12' );
		expect( propertyKey( systemFields()[ 0 ] ) ).toBe( 'created_at' );
	} );
} );
