// Client-side helpers for the Notion → Cortext importer.
//
// `extractCollections` populates the Collections list: one paginated
// `/search` call that returns every reachable data source with its
// schema inline. The actual row import runs server-side via
// `runImport`, which loops the `/cortext/v1/notion/import/{start,tick}`
// routes.

import apiFetch from '@wordpress/api-fetch';

const RATE_LIMIT_RETRIES = 5;
const RATE_LIMIT_BASE_MS = 1000;
const RATE_LIMIT_MAX_MS = 16000;

// Notion's documented soft limit is ~3 rps per integration with bursts.
// On a 429 the proxy mirrors Notion's status; apiFetch then rejects with
// the upstream JSON body, which includes `code: "rate_limited"`. We
// don't yet forward `Retry-After` through the proxy, so the backoff is
// blind exponential with jitter — replace with header-driven delays once
// the proxy passes the header through.
async function notion( key, method, path, body, attempt = 0 ) {
	try {
		return await apiFetch( {
			path: '/cortext/v1/notion/proxy',
			method: 'POST',
			headers: { 'X-Notion-Key': key },
			data: { method, path, body },
		} );
	} catch ( err ) {
		if ( err?.code === 'rate_limited' && attempt < RATE_LIMIT_RETRIES ) {
			const base = Math.min(
				RATE_LIMIT_BASE_MS * 2 ** attempt,
				RATE_LIMIT_MAX_MS
			);
			const delay = base + Math.random() * 500;
			await new Promise( ( resolve ) => setTimeout( resolve, delay ) );
			return notion( key, method, path, body, attempt + 1 );
		}
		throw err;
	}
}

async function paginate( call ) {
	const results = [];
	let cursor;
	do {
		const page = await call( cursor );
		results.push( ...( page.results ?? [] ) );
		cursor = page.has_more ? page.next_cursor : null;
	} while ( cursor );
	return results;
}

function slugify( str ) {
	return str
		.toLowerCase()
		.replace( /[^a-z0-9]+/g, '-' )
		.replace( /^-|-$/g, '' );
}

// In 2026-03-11, `/search` returns full data-source objects with
// `properties` (schema) and `parent` inline. That delivers everything we
// need to plan the rest of the extraction without per-DB schema fetches.
function fetchAllDataSources( key ) {
	return paginate( ( cursor ) =>
		notion( key, 'POST', '/search', {
			filter: { value: 'data_source', property: 'object' },
			page_size: 100,
			...( cursor && { start_cursor: cursor } ),
		} )
	);
}

function transformField( name, prop ) {
	// Notion returns property IDs URL-encoded in property objects (so
	// they're URL-safe for path params) but decoded inside view
	// configurations. Normalise to the decoded form everywhere so
	// `fields[].id` and `entries[].values` keys line up.
	const field = {
		id: decodeURIComponent( prop.id ),
		name,
		type: prop.type,
	};
	switch ( prop.type ) {
		case 'select':
			field.options = ( prop.select?.options ?? [] ).map( ( o ) => ( {
				id: o.id,
				name: o.name,
				color: o.color,
			} ) );
			break;
		case 'multi_select':
			field.options = ( prop.multi_select?.options ?? [] ).map(
				( o ) => ( { id: o.id, name: o.name, color: o.color } )
			);
			break;
		case 'status':
			field.options = ( prop.status?.options ?? [] ).map( ( o ) => ( {
				id: o.id,
				name: o.name,
				color: o.color,
			} ) );
			field.groups = ( prop.status?.groups ?? [] ).map( ( g ) => ( {
				id: g.id,
				name: g.name,
				color: g.color,
				option_ids: g.option_ids,
			} ) );
			break;
		case 'relation':
			field.related_database_id = prop.relation?.database_id ?? null;
			break;
		case 'number':
			field.format = prop.number?.format ?? 'number';
			break;
		case 'formula':
			field.expression = prop.formula?.expression ?? '';
			break;
		case 'rollup':
			field.relation_field = prop.rollup?.relation_property_name ?? null;
			field.rollup_field = prop.rollup?.rollup_property_name ?? null;
			field.function = prop.rollup?.function ?? null;
			break;
	}
	return field;
}

function transformSchema( rawProperties ) {
	return (
		Object.entries( rawProperties )
			.map( ( [ name, prop ] ) => transformField( name, prop ) )
			// Ensure title comes first
			.sort( ( a, b ) => {
				if ( a.type === 'title' ) {
					return -1;
				}
				if ( b.type === 'title' ) {
					return 1;
				}
				return 0;
			} )
	);
}

/**
 * Cheap upfront pass: one paginated `/search` returns every data source
 * the integration can reach, with schema inline. Used to populate the
 * collections list — row import runs server-side, see `runImport`.
 *
 * @param {string} key Notion integration key.
 * @return {Promise<{collections: Array}>} The list of collections.
 */
export async function extractCollections( key ) {
	const rawDataSources = await fetchAllDataSources( key );

	// Build the parent-db → data-source-ids map from the inline /search
	// payload, no extra API calls. Used below to rewrite relation
	// targets: Notion exposes them by parent database id, but everything
	// downstream keys by data source id.
	const dbIdToDataSourceIds = {};
	for ( const rawDb of rawDataSources ) {
		const parentId = rawDb.parent?.database_id;
		if ( parentId ) {
			( dbIdToDataSourceIds[ parentId ] ??= [] ).push( rawDb.id );
		}
	}

	const collections = rawDataSources.map( ( rawDb ) => {
		const fields = transformSchema( rawDb.properties ?? {} );
		for ( const field of fields ) {
			if ( field.type === 'relation' && field.related_database_id ) {
				const resolved =
					dbIdToDataSourceIds[ field.related_database_id ];
				if ( resolved ) {
					field.related_database_id =
						resolved.length === 1 ? resolved[ 0 ] : resolved;
				}
			}
		}
		const title = rawDb.title?.[ 0 ]?.plain_text ?? '';
		return {
			id: rawDb.id,
			slug: slugify( title ),
			title,
			parent_database_id: rawDb.parent?.database_id ?? null,
			fields,
		};
	} );

	return { collections };
}

// ---------------------------------------------------------------------
// Server-side import (the real write path)
// ---------------------------------------------------------------------
//
// Three small helpers wrapping the new `cortext/v1/notion/import/*`
// routes. The orchestration is intentionally client-driven: PHP per
// call stays well under any timeout, the client loops `tick` until
// done, and progress is whatever the server reports back.

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
