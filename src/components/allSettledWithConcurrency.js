export default async function allSettledWithConcurrency(
	items,
	concurrency,
	callback
) {
	const results = new Array( items.length );
	const workerCount = Math.min( Math.max( concurrency, 1 ), items.length );
	let nextIndex = 0;

	await Promise.all(
		Array.from( { length: workerCount }, async () => {
			while ( nextIndex < items.length ) {
				const index = nextIndex;
				nextIndex += 1;

				try {
					results[ index ] = {
						status: 'fulfilled',
						value: await callback( items[ index ], index ),
					};
				} catch ( error ) {
					results[ index ] = {
						status: 'rejected',
						reason: error,
					};
				}
			}
		} )
	);

	return results;
}
