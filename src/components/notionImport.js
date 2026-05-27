// Thin client for the Cortext-side Notion REST routes. The client never
// speaks Notion's protocol directly: the controller handles search,
// schema fetch, and row fetch server-side. We only orchestrate the
// import lifecycle here (start → tick → done).

import apiFetch from '@wordpress/api-fetch';

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
	while ( state.has_more ) {
		state = await tickImport( key, state.job_id );
		onProgress?.( state );
	}
	return state;
}
