import {
	DEFAULT_MIN_WIDTH,
	MAX_COLUMN_WIDTH,
	MIN_WIDTHS,
	TITLE_FIELD_ID,
	clampWidth,
	getMinWidth,
	normalizeView,
	withColumnOrder,
	withColumnWidth,
} from '../../../src/components/dataViewColumns';

describe( 'getMinWidth', () => {
	it( 'returns the per-type floor for types that need extra room', () => {
		expect( getMinWidth( 'title' ) ).toBe( MIN_WIDTHS.title );
		expect( getMinWidth( 'date' ) ).toBe( MIN_WIDTHS.date );
		expect( getMinWidth( 'datetime' ) ).toBe( MIN_WIDTHS.datetime );
	} );

	it( 'falls back to the default floor for short types', () => {
		expect( getMinWidth( undefined ) ).toBe( DEFAULT_MIN_WIDTH );
		expect( getMinWidth( 'mystery' ) ).toBe( DEFAULT_MIN_WIDTH );
		expect( getMinWidth( 'text' ) ).toBe( DEFAULT_MIN_WIDTH );
		expect( getMinWidth( 'integer' ) ).toBe( DEFAULT_MIN_WIDTH );
		expect( getMinWidth( 'boolean' ) ).toBe( DEFAULT_MIN_WIDTH );
	} );

	it( 'uses a compact default floor', () => {
		expect( DEFAULT_MIN_WIDTH ).toBe( 32 );
	} );
} );

describe( 'clampWidth', () => {
	it( 'clamps below-min widths up to the per-type floor', () => {
		expect( clampWidth( 10, 'text' ) ).toBe( DEFAULT_MIN_WIDTH );
		expect( clampWidth( 10, 'title' ) ).toBe( MIN_WIDTHS.title );
	} );

	it( 'clamps above-max widths down to the cap', () => {
		expect( clampWidth( 9999, 'text' ) ).toBe( MAX_COLUMN_WIDTH );
	} );

	it( 'rounds to a whole pixel', () => {
		expect( clampWidth( 240.6, 'text' ) ).toBe( 241 );
	} );

	it( 'falls back to the per-type floor for non-finite values', () => {
		expect( clampWidth( NaN, 'boolean' ) ).toBe( DEFAULT_MIN_WIDTH );
		expect( clampWidth( null, 'title' ) ).toBe( MIN_WIDTHS.title );
	} );

	it( 'uses the default floor when no type is provided', () => {
		expect( clampWidth( 10 ) ).toBe( DEFAULT_MIN_WIDTH );
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

	it( 'clamps persisted widths to the [0, max] range and rejects negatives', () => {
		const view = {
			...baseView(),
			layout: {
				density: 'compact',
				styles: {
					'field-1': { width: -10 },
					'field-2': { width: 9999 },
				},
			},
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1', 'field-2' ] )
		);
		expect( next.layout.styles[ 'field-1' ].width ).toBe( 0 );
		expect( next.layout.styles[ 'field-2' ].width ).toBe(
			MAX_COLUMN_WIDTH
		);
	} );

	it( 'preserves CSS string widths supported by DataViews', () => {
		const view = {
			...baseView(),
			layout: {
				density: 'compact',
				styles: {
					'field-1': {
						width: '240px',
						minWidth: '12ch',
						maxWidth: '30rem',
					},
					'field-2': { width: '20ch' },
				},
			},
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1', 'field-2' ] )
		);
		expect( next ).toBe( view );
		expect( next.layout.styles[ 'field-1' ] ).toEqual( {
			width: '240px',
			minWidth: '12ch',
			maxWidth: '30rem',
		} );
		expect( next.layout.styles[ 'field-2' ].width ).toBe( '20ch' );
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

	it( 'keeps calculations for hidden fields that still exist', () => {
		const view = {
			...baseView(),
			fields: [ TITLE_FIELD_ID ],
			calculations: { 'field-1': 'sum' },
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1' ] ),
			{
				fields: [
					{ id: TITLE_FIELD_ID, cortextType: 'title' },
					{ id: 'field-1', cortextType: 'number' },
				],
			}
		);
		expect( next.calculations ).toEqual( { 'field-1': 'sum' } );
	} );

	it( 'prunes calculations for removed, ghost, and disallowed fields', () => {
		const view = {
			...baseView(),
			calculations: {
				'field-1': 'sum',
				'field-2': 'max',
				'field-removed': 'count',
				__add_field: 'count',
			},
		};
		const next = normalizeView(
			view,
			new Set( [ TITLE_FIELD_ID, 'field-1', 'field-2' ] ),
			{
				fields: [
					{ id: TITLE_FIELD_ID, cortextType: 'title' },
					{ id: 'field-1', cortextType: 'text' },
					{ id: 'field-2', cortextType: 'number' },
				],
			}
		);
		expect( next.calculations ).toEqual( { 'field-2': 'max' } );
	} );
} );

describe( 'withColumnWidth', () => {
	it( 'writes the clamped width plus per-type min and matching maxWidth', () => {
		const view = { layout: { density: 'compact' } };
		const next = withColumnWidth( view, 'field-1', 220, 'text' );
		expect( next.layout.styles[ 'field-1' ] ).toEqual( {
			width: 220,
			minWidth: DEFAULT_MIN_WIDTH,
			maxWidth: 220,
		} );
	} );

	it( 'lets short-content columns commit a smaller width than the title', () => {
		const view = { layout: { density: 'compact' } };
		const text = withColumnWidth( view, 'field-t', 10, 'text' );
		const title = withColumnWidth( view, 'field-title', 10, 'title' );
		expect( text.layout.styles[ 'field-t' ].width ).toBeLessThan(
			title.layout.styles[ 'field-title' ].width
		);
		expect( text.layout.styles[ 'field-t' ].width ).toBe(
			DEFAULT_MIN_WIDTH
		);
	} );

	it( 'preserves layout.density and existing styles for other fields', () => {
		const view = {
			layout: {
				density: 'compact',
				styles: { 'field-other': { width: 160 } },
			},
		};
		const next = withColumnWidth( view, 'field-1', 220, 'text' );
		expect( next.layout.density ).toBe( 'compact' );
		expect( next.layout.styles[ 'field-other' ] ).toEqual( {
			width: 160,
		} );
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
