import allSettledWithConcurrency from '../../../src/components/allSettledWithConcurrency';

describe( 'allSettledWithConcurrency', () => {
	it( 'limits concurrent tasks and preserves result order', async () => {
		let active = 0;
		let maxActive = 0;

		const results = await allSettledWithConcurrency(
			[ 1, 2, 3, 4, 5 ],
			2,
			async ( value ) => {
				active += 1;
				maxActive = Math.max( maxActive, active );
				await Promise.resolve();
				active -= 1;
				return value * 2;
			}
		);

		expect( maxActive ).toBeLessThanOrEqual( 2 );
		expect( results ).toEqual( [
			{ status: 'fulfilled', value: 2 },
			{ status: 'fulfilled', value: 4 },
			{ status: 'fulfilled', value: 6 },
			{ status: 'fulfilled', value: 8 },
			{ status: 'fulfilled', value: 10 },
		] );
	} );

	it( 'returns rejected results without stopping later tasks', async () => {
		const error = new Error( 'Nope' );

		const results = await allSettledWithConcurrency(
			[ 'a', 'b', 'c' ],
			2,
			async ( value ) => {
				if ( value === 'b' ) {
					throw error;
				}
				return value.toUpperCase();
			}
		);

		expect( results ).toEqual( [
			{ status: 'fulfilled', value: 'A' },
			{ status: 'rejected', reason: error },
			{ status: 'fulfilled', value: 'C' },
		] );
	} );
} );
