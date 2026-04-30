import {
	MAX_COLUMN_WIDTH,
	MIN_COLUMN_WIDTH,
	MIN_TITLE_WIDTH,
	TITLE_FIELD_ID,
	clampWidth,
	getMinWidth,
	normalizeView,
	withColumnOrder,
	withColumnWidth,
} from '../../../src/components/dataViewColumns';

describe( 'getMinWidth', () => {
	it( 'returns the title floor for the title id', () => {
		expect( getMinWidth( TITLE_FIELD_ID ) ).toBe( MIN_TITLE_WIDTH );
	} );

	it( 'returns the standard floor for non-title columns', () => {
		expect( getMinWidth( 'field-7' ) ).toBe( MIN_COLUMN_WIDTH );
	} );
} );

describe( 'clampWidth', () => {
	it( 'clamps below-min widths up to the column floor', () => {
		expect( clampWidth( 10, 'field-7' ) ).toBe( MIN_COLUMN_WIDTH );
	} );

	it( 'clamps above-max widths down to the cap', () => {
		expect( clampWidth( 9999, 'field-7' ) ).toBe( MAX_COLUMN_WIDTH );
	} );

	it( 'rounds to a whole pixel', () => {
		expect( clampWidth( 240.6, 'field-7' ) ).toBe( 241 );
	} );

	it( 'falls back to the floor when given a non-finite value', () => {
		expect( clampWidth( NaN, 'field-7' ) ).toBe( MIN_COLUMN_WIDTH );
		expect( clampWidth( null, 'field-7' ) ).toBe( MIN_COLUMN_WIDTH );
	} );

	it( 'uses the higher title floor for the title id', () => {
		expect( clampWidth( 100, TITLE_FIELD_ID ) ).toBe( MIN_TITLE_WIDTH );
	} );
} );

describe( 'normalizeView', () => {
	const baseView = () => ( {
		type: 'table',
		fields: [ TITLE_FIELD_ID, 'field-1', 'field-2' ],
		sort: null,
		filters: [],
		layout: { density: 'compact' },
	} );

	it( 'returns the same reference when nothing changes', () => {
		const view = baseView();
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1', 'field-2' ] )
		);
		expect( next ).toBe( view );
	} );

	it( 'drops fields whose ids are no longer in the schema', () => {
		const view = baseView();
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1' ] )
		);
		expect( next.fields ).toEqual( [ TITLE_FIELD_ID, 'field-1' ] );
	} );

	it( 'prepends the title id when fields filtered it out', () => {
		const view = { ...baseView(), fields: [ 'field-1', 'field-2' ] };
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1', 'field-2' ] )
		);
		expect( next.fields[ 0 ] ).toBe( TITLE_FIELD_ID );
	} );

	it( 'prunes layout.styles entries for fields that no longer exist', () => {
		const view = {
			...baseView(),
			layout: {
				density: 'compact',
				styles: {
					'field-1': { width: 200 },
					'field-removed': { width: 200 },
				},
			},
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1', 'field-2' ] )
		);
		expect( next.layout.styles ).toEqual( {
			'field-1': { width: 200 },
		} );
	} );

	it( 'clamps persisted widths into the current [min, max] range', () => {
		const view = {
			...baseView(),
			layout: {
				density: 'compact',
				styles: {
					'field-1': { width: 5 },
					'field-2': { width: 9999 },
				},
			},
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1', 'field-2' ] )
		);
		expect( next.layout.styles[ 'field-1' ].width ).toBe(
			MIN_COLUMN_WIDTH
		);
		expect( next.layout.styles[ 'field-2' ].width ).toBe(
			MAX_COLUMN_WIDTH
		);
	} );

	it( 'preserves layout.density and other layout keys', () => {
		const view = {
			...baseView(),
			layout: { density: 'comfortable', somethingElse: 'keep' },
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1' ] )
		);
		expect( next.layout.density ).toBe( 'comfortable' );
		expect( next.layout.somethingElse ).toBe( 'keep' );
	} );

	it( 'drops the styles key entirely when no entries survive', () => {
		const view = {
			...baseView(),
			layout: {
				density: 'compact',
				styles: { 'field-removed': { width: 200 } },
			},
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1' ] )
		);
		expect( next.layout.styles ).toBeUndefined();
		expect( next.layout.density ).toBe( 'compact' );
	} );
} );

describe( 'withColumnWidth', () => {
	it( 'writes the clamped width plus min/max bounds the library reads', () => {
		const view = { layout: { density: 'compact' } };
		const next = withColumnWidth( view, 'field-1', 220 );
		expect( next.layout.styles[ 'field-1' ] ).toEqual( {
			width: 220,
			minWidth: MIN_COLUMN_WIDTH,
			maxWidth: MAX_COLUMN_WIDTH,
		} );
	} );

	it( 'preserves layout.density and existing styles for other fields', () => {
		const view = {
			layout: {
				density: 'compact',
				styles: { 'field-other': { width: 160 } },
			},
		};
		const next = withColumnWidth( view, 'field-1', 220 );
		expect( next.layout.density ).toBe( 'compact' );
		expect( next.layout.styles[ 'field-other' ] ).toEqual( {
			width: 160,
		} );
	} );

	it( 'clamps a tiny width up to the floor', () => {
		const view = {};
		const next = withColumnWidth( view, 'field-1', 5 );
		expect( next.layout.styles[ 'field-1' ].width ).toBe(
			MIN_COLUMN_WIDTH
		);
	} );
} );

describe( 'withColumnOrder', () => {
	const view = ( fields ) => ( { fields } );

	it( 'moves a column to the requested index', () => {
		const next = withColumnOrder(
			view( [ TITLE_FIELD_ID, 'a', 'b', 'c' ] ),
			1,
			3
		);
		expect( next.fields ).toEqual( [ TITLE_FIELD_ID, 'b', 'c', 'a' ] );
	} );

	it( 'moves the title id like any other column', () => {
		const next = withColumnOrder(
			view( [ TITLE_FIELD_ID, 'a', 'b' ] ),
			0,
			2
		);
		expect( next.fields ).toEqual( [ 'a', 'b', TITLE_FIELD_ID ] );
	} );

	it( 'allows a column to land left of the title', () => {
		const next = withColumnOrder(
			view( [ TITLE_FIELD_ID, 'a', 'b' ] ),
			2,
			0
		);
		expect( next.fields ).toEqual( [ 'b', TITLE_FIELD_ID, 'a' ] );
	} );

	it( 'returns the same view for invalid indices', () => {
		const v = view( [ TITLE_FIELD_ID, 'a', 'b' ] );
		expect( withColumnOrder( v, -1, 1 ) ).toBe( v );
		expect( withColumnOrder( v, 1, 99 ) ).toBe( v );
		expect( withColumnOrder( v, 1, 1 ) ).toBe( v );
	} );
} );
