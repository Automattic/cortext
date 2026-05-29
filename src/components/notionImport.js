// Thin client for the Cortext-side Notion REST routes. The client never
// speaks Notion's protocol directly: the controller handles search,
// schema fetch, and row fetch server-side. We only orchestrate the
// import lifecycle here (start → tick → done).

import apiFetch from '@wordpress/api-fetch';

// Consecutive ticks during which `processed` stays flat while the
// server still claims `has_more`. One such page is plausible (e.g. a
// Notion view that returns zero results on a page); two in a row likely
// means an infinite loop and we'd rather fail loud.
const MAX_STALLED_TICKS = 2;

// HTTP 429 (Too Many Requests): limit for Retry-After values. In practice,
// Notion should never emit a value close to this.
const MAX_RETRY_AFTER_SECS = 60;

const sleep = ( ms ) => new Promise( ( r ) => setTimeout( r, ms ) );

/**
 * GET /cortext/v1/notion/collections — every data source reachable
 * with the given key, as `{ id, title }`. Used to populate the Import
 * screen's list.
 *
 * @param {string} key Notion integration key.
 * @return {Promise<{collections: Array}>} The list of collections.
 */
export function extractCollections( key ) {
	return apiFetch( {
		path: '/cortext/v1/notion/collections',
		headers: { 'X-Notion-Key': key },
	} );
}

// POST /cortext/v1/notion/import/start — creates the Cortext collection.
function startImport( key, dataSourceId ) {
	return apiFetch( {
		path: '/cortext/v1/notion/import/start',
		method: 'POST',
		headers: { 'X-Notion-Key': key },
		data: { data_source_id: dataSourceId },
	} );
}

// POST /cortext/v1/notion/import/{jobId}/tick — writes one batch of rows.
function tickImport( key, jobId ) {
	return apiFetch( {
		path: `/cortext/v1/notion/import/${ encodeURIComponent( jobId ) }/tick`,
		method: 'POST',
		headers: { 'X-Notion-Key': key },
	} );
}

// POST /cortext/v1/notion/import/{jobId}/finish — drops the persisted
// job record once the client has observed the terminal state.
function finishImport( key, jobId ) {
	return apiFetch( {
		path: `/cortext/v1/notion/import/${ encodeURIComponent(
			jobId
		) }/finish`,
		method: 'POST',
		headers: { 'X-Notion-Key': key },
	} );
}

/**
 * Run an import end-to-end: start, then tick until done. `onProgress`
 * is invoked after every tick with the latest `{ processed, status,
 * has_more, collection_id }`. Resolves with the final state, or
 * rejects with the first error encountered (the partial collection
 * stays behind in Cortext — per the v1 "always new copy" decision the
 * user can re-run from scratch).
 *
 * @param {string}   key          Notion integration key.
 * @param {string}   dataSourceId The data source to import.
 * @param {Function} onProgress   Optional progress callback.
 * @return {Promise<Object>}      Terminal job state.
 */
export async function runImport( key, dataSourceId, onProgress ) {
	const started = await startImport( key, dataSourceId );
	onProgress?.( started );

	let state = started;
	let stalledTicks = 0;
	while ( state.has_more ) {
		let next;
		try {
			next = await tickImport( key, state.job_id );
		} catch ( err ) {
			if ( err?.data?.status !== 429 ) {
				throw err;
			}

			// HTTP 429 (Too Many Requests)
			const wait = Math.min(
				MAX_RETRY_AFTER_SECS,
				Math.max( 1, Number( err.data.retry_after ) || 1 )
			);
			onProgress?.( { ...state, retryAfter: wait } );
			await sleep( wait * 1000 );
			onProgress?.( { ...state, retryAfter: 0 } );
			continue;
		}

		// A tick that left `processed` unchanged while still claiming
		// `has_more` is a stall signal: either the server didn't fetch
		// new rows from Notion, or `import_rows` inserted zero. One
		// such page can happen; consecutive stalls almost certainly
		// mean a runaway loop, so we bail.
		if ( next.has_more && next.processed === state.processed ) {
			stalledTicks += 1;
			if ( stalledTicks >= MAX_STALLED_TICKS ) {
				throw new Error(
					`Import stalled: ${ stalledTicks } consecutive ticks ` +
						'left the processed count unchanged while the ' +
						'server still reports more rows. Aborting.'
				);
			}
		} else {
			stalledTicks = 0;
		}

		state = next;
		onProgress?.( state );
	}

	// Best-effort cleanup: failure here doesn't change the import
	// outcome — we still resolve with the terminal state.
	finishImport( key, state.job_id ).catch( () => {} );

	return state;
}
