import {
	dateRangeEnd,
	dateRangeStart,
	joinDateRange,
	parseDateRange,
	sortByDateRangeStart,
} from '../../../src/utils/dateRange';

describe( 'dateRange', () => {
	it( 'splits ranges and leaves single dates alone', () => {
		expect( parseDateRange( '2026-03-01/2026-06-30' ) ).toEqual( {
			start: '2026-03-01',
			end: '2026-06-30',
		} );
		expect( parseDateRange( '2026-03-01' ) ).toEqual( {
			start: '2026-03-01',
			end: null,
		} );
		expect( parseDateRange( '03/01/2026' ) ).toEqual( {
			start: '03/01/2026',
			end: null,
		} );
		expect( parseDateRange( '' ) ).toBeNull();
		expect( parseDateRange( null ) ).toBeNull();
	} );

	it( 'joins an end only when it differs from the start', () => {
		expect( joinDateRange( '2026-03-01', '2026-06-30' ) ).toBe(
			'2026-03-01/2026-06-30'
		);
		expect( joinDateRange( '2026-03-01', '2026-03-01' ) ).toBe(
			'2026-03-01'
		);
		expect( joinDateRange( '2026-03-01', '' ) ).toBe( '2026-03-01' );
		expect( joinDateRange( '', '2026-03-05' ) ).toBe( '2026-03-05' );
	} );

	it( 'reads the edges, with a single date as both', () => {
		expect( dateRangeStart( '2026-03-01/2026-06-30' ) ).toBe(
			'2026-03-01'
		);
		expect( dateRangeEnd( '2026-03-01/2026-06-30' ) ).toBe( '2026-06-30' );
		expect( dateRangeEnd( '2026-03-01' ) ).toBe( '2026-03-01' );
	} );

	it( 'sorts ranges by their start', () => {
		const values = [ '2026-03-05', '2026-03-01/2026-12-31', '2026-03-03' ];
		expect(
			[ ...values ].sort( ( a, b ) =>
				sortByDateRangeStart( a, b, 'asc' )
			)
		).toEqual( [ '2026-03-01/2026-12-31', '2026-03-03', '2026-03-05' ] );
	} );
} );
