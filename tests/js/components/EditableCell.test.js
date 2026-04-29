import {
	dateOnlyValue,
	formatDisplay,
} from '../../../src/components/EditableCell';

describe( 'EditableCell helpers', () => {
	it( 'formats date-only values as local calendar dates', () => {
		expect( formatDisplay( '2026-04-16', 'date' ) ).toBe(
			new Date( 2026, 3, 16 ).toLocaleDateString()
		);
	} );

	it( 'preserves date-only storage when date editors emit datetimes', () => {
		expect( dateOnlyValue( '2026-04-16T14:30:00' ) ).toBe( '2026-04-16' );
		expect( dateOnlyValue( '2026-04-16' ) ).toBe( '2026-04-16' );
	} );
} );
