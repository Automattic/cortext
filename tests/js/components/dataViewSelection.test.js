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
	it( 'keeps off-page selections when the visible page changes', () => {
		expect(
			mergeVisibleSelection( [ 'off-page', '1' ], [ '2' ], [ '1', '2' ] )
		).toEqual( [ 'off-page', '2' ] );
	} );

	it( 'ignores DataViews row clicks without a selection intent', () => {
		expect(
			applyVisibleSelectionChange(
				[ 'off-page', '1' ],
				[ '2' ],
				[ '1', '2' ]
			)
		).toEqual( [ 'off-page', '1' ] );
	} );

	it( 'keeps off-page selections when modifier clicks change the visible page', () => {
		expect(
			applyVisibleSelectionChange(
				[ 'off-page', '1' ],
				[ '1', '2' ],
				[ '1', '2' ],
				{ type: 'merge' }
			)
		).toEqual( [ 'off-page', '1', '2' ] );
	} );

	it( 'adds the checkbox target when DataViews reports the row click first', () => {
		expect(
			applyVisibleSelectionChange( [ '1' ], [ '2' ], [ '1', '2' ], {
				type: 'merge',
				source: 'checkbox',
				targetId: '2',
			} )
		).toEqual( [ '1', '2' ] );
	} );

	it( 'selects the visible range between anchor and target', () => {
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

	it( 'selects the target when the range anchor is missing', () => {
		expect( rangeSelection( [ '1', '2', '3' ], '9', '2' ) ).toEqual( [
			'2',
		] );
	} );

	it( 'toggles visible rows without losing off-page selections', () => {
		expect(
			toggleVisibleSelection( [ 'off-page' ], [ '1', '2' ] )
		).toEqual( [ 'off-page', '1', '2' ] );
		expect(
			toggleVisibleSelection( [ 'off-page', '1', '2' ], [ '1', '2' ] )
		).toEqual( [ 'off-page' ] );
	} );

	it( 'removes deleted rows from selection', () => {
		expect( removeDeletedSelection( [ '1', 2, '3' ], [ 2 ] ) ).toEqual( [
			'1',
			'3',
		] );
	} );

	it( 'orders rows the way grouped DataViews renders them', () => {
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
