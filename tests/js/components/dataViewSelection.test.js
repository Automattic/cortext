import {
	applyVisibleSelectionChange,
	mergeVisibleSelection,
	rangeSelection,
	removeDeletedSelection,
	rowIds,
	rowsInDataViewRenderOrder,
	toggleVisibleSelection,
} from '../../../src/components/dataViewSelection';

describe( 'dataViewSelection', () => {
	it( 'merges current-page selection changes without dropping hidden selections', () => {
		expect(
			mergeVisibleSelection( [ 'off-page', '1' ], [ '2' ], [ '1', '2' ] )
		).toEqual( [ 'off-page', '2' ] );
	} );

	it( 'ignores selection changes without an explicit selection intent', () => {
		expect(
			applyVisibleSelectionChange(
				[ 'off-page', '1' ],
				[ '2' ],
				[ '1', '2' ]
			)
		).toEqual( [ 'off-page', '1' ] );
	} );

	it( 'preserves hidden selections for modifier toggles', () => {
		expect(
			applyVisibleSelectionChange(
				[ 'off-page', '1' ],
				[ '1', '2' ],
				[ '1', '2' ],
				{ type: 'merge' }
			)
		).toEqual( [ 'off-page', '1', '2' ] );
	} );

	it( 'adds a checkbox target when the table row click reports a singleton first', () => {
		expect(
			applyVisibleSelectionChange( [ '1' ], [ '2' ], [ '1', '2' ], {
				type: 'merge',
				source: 'checkbox',
				targetId: '2',
			} )
		).toEqual( [ '1', '2' ] );
	} );

	it( 'selects a visible range from the anchor to the target', () => {
		expect( rangeSelection( [ '1', '2', '3', '4' ], '2', '4' ) ).toEqual( [
			'2',
			'3',
			'4',
		] );
		expect( rangeSelection( [ '1', '2', '3', '4' ], '4', '2' ) ).toEqual( [
			'2',
			'3',
			'4',
		] );
	} );

	it( 'falls back to the target when a range anchor is unavailable', () => {
		expect( rangeSelection( [ '1', '2', '3' ], '9', '2' ) ).toEqual( [
			'2',
		] );
	} );

	it( 'toggles all visible rows without dropping hidden selections', () => {
		expect(
			toggleVisibleSelection( [ 'off-page' ], [ '1', '2' ] )
		).toEqual( [ 'off-page', '1', '2' ] );
		expect(
			toggleVisibleSelection( [ 'off-page', '1', '2' ], [ '1', '2' ] )
		).toEqual( [ 'off-page' ] );
	} );

	it( 'removes deleted rows from selection', () => {
		expect( removeDeletedSelection( [ '1', '2', '3' ], [ 2 ] ) ).toEqual( [
			'1',
			'3',
		] );
	} );

	it( 'matches DataViews grouped render order', () => {
		const rows = [
			{ id: 1, status: 'A' },
			{ id: 2, status: 'B' },
			{ id: 3, status: 'A' },
			{ id: 4, status: 'B' },
		];
		const fields = [
			{
				id: 'status',
				getValue: ( { item } ) => item.status,
			},
		];

		expect(
			rowIds(
				rowsInDataViewRenderOrder(
					rows,
					{ groupByField: 'status' },
					fields
				)
			)
		).toEqual( [ '1', '3', '2', '4' ] );
	} );
} );
