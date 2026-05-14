import {
	ROW_DROP_AFTER,
	ROW_DROP_BEFORE,
	computeReorderRequest,
} from '../../../src/components/row-reorder';

const rows = [ { id: 1 }, { id: 2 }, { id: 3 } ];

describe( 'computeReorderRequest', () => {
	it( 'computes neighbors for a before drop', () => {
		expect(
			computeReorderRequest( rows, 3, 2, ROW_DROP_BEFORE )
		).toEqual( {
			before_id: 2,
			after_id: 1,
		} );
	} );

	it( 'uses null after_id when dropping before the first row', () => {
		expect(
			computeReorderRequest( rows, 3, 1, ROW_DROP_BEFORE )
		).toEqual( {
			before_id: 1,
			after_id: null,
		} );
	} );

	it( 'computes neighbors for an after drop', () => {
		expect(
			computeReorderRequest( rows, 1, 2, ROW_DROP_AFTER )
		).toEqual( {
			before_id: 3,
			after_id: 2,
		} );
	} );

	it( 'uses null before_id when dropping after the last row', () => {
		expect(
			computeReorderRequest( rows, 1, 3, ROW_DROP_AFTER )
		).toEqual( {
			before_id: null,
			after_id: 3,
		} );
	} );

	it( 'returns null when dropping on the dragged row', () => {
		expect(
			computeReorderRequest( rows, 2, 2, ROW_DROP_BEFORE )
		).toBeNull();
	} );

	it( 'returns null for adjacent no-op drops', () => {
		expect(
			computeReorderRequest( rows, 2, 3, ROW_DROP_BEFORE )
		).toBeNull();
		expect(
			computeReorderRequest( rows, 2, 1, ROW_DROP_AFTER )
		).toBeNull();
	} );
} );
