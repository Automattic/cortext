import {
	adjacentRowId,
	getRowDetailMode,
	normalizeRowDetailMode,
	splitPropertyPatch,
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
	it( 'separates title edits from meta edits', () => {
		expect(
			splitPropertyPatch(
				{
					title: 'Next title',
					'field-1': 'Author',
					'field-2': true,
				},
				{ 'field-1': 'Previous', 'field-3': 'Kept' }
			)
		).toEqual( {
			title: 'Next title',
			meta: {
				'field-1': 'Author',
				'field-2': true,
				'field-3': 'Kept',
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
