// Client-side extractor for the Notion → Cortext importer. Drives the
// Notion API through `cortext/v1/notion/proxy`.
//
// Two stages, deliberately split:
//   - `extractAll` is cheap: one `/search` paginated call that returns
//     every reachable data source with its schema inline. We use it to
//     populate the Collections list as soon as the screen mounts.
//   - `extractCollection` is the per-collection fetch: rows for one data
//     source on demand, the moment a user picks it from the list.
//
// Splitting it this way keeps the upfront cost flat (independent of
// workspace size), and pushes the rest of the I/O behind user intent.

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

function fetchEntries( key, dataSourceId ) {
	return paginate( ( cursor ) =>
		notion( key, 'POST', `/data_sources/${ dataSourceId }/query`, {
			...( cursor && { start_cursor: cursor } ),
		} )
	);
}

// Page block tree, for any future row-detail surface. Recursively walks
// children (toggles, columns, callouts, …) so callers receive the full
// document.
export async function fetchPageBlocks( key, blockId ) {
	const children = await paginate( ( cursor ) =>
		notion(
			key,
			'GET',
			`/blocks/${ blockId }/children?page_size=100${
				cursor ? `&start_cursor=${ cursor }` : ''
			}`
		)
	);
	return Promise.all(
		children.map( async ( block ) => {
			if ( block.has_children ) {
				const nested = await fetchPageBlocks( key, block.id );
				return { ...block, children: nested };
			}
			return block;
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

function cellValue( prop ) {
	switch ( prop.type ) {
		case 'title':
			return prop.title.map( ( t ) => t.plain_text ).join( '' );
		case 'rich_text':
			return prop.rich_text.map( ( t ) => t.plain_text ).join( '' );
		case 'number':
			return prop.number ?? null;
		case 'select':
			return prop.select?.name ?? null;
		case 'multi_select':
			return prop.multi_select.map( ( s ) => s.name );
		case 'status':
			return prop.status?.name ?? null;
		case 'date':
			return prop.date?.start ?? null;
		case 'checkbox':
			return prop.checkbox;
		case 'url':
			return prop.url ?? null;
		case 'email':
			return prop.email ?? null;
		case 'phone_number':
			return prop.phone_number ?? null;
		case 'people':
			return prop.people.map( ( p ) => ( {
				id: p.id,
				name: p.name ?? null,
			} ) );
		case 'relation':
			// IDs only — the importer resolves them through the global
			// entry-id map once every entry has been created.
			return prop.relation.map( ( r ) => r.id );
		case 'formula':
			return prop.formula[ prop.formula.type ] ?? null;
		case 'rollup': {
			const r = prop.rollup;
			if ( r.type === 'array' ) {
				return r.array;
			}
			if ( r.type === 'number' ) {
				return r.number ?? null;
			}
			return null;
		}
		default:
			return null;
	}
}

function transformEntry( raw ) {
	const values = {};
	let title = '';
	for ( const prop of Object.values( raw.properties ) ) {
		const propId = decodeURIComponent( prop.id );
		values[ propId ] = cellValue( prop );
		if ( prop.type === 'title' ) {
			title = values[ propId ];
		}
	}
	return { id: raw.id, title, values };
}

/**
 * Cheap upfront pass: one paginated `/search` returns every data source
 * the integration can reach, with schema inline. No entries, no views —
 * those come later via `extractCollection`.
 *
 * @param {string} key Notion integration key.
 * @return {Promise<{extracted_at: string, collections: Array}>} The
 *   extraction timestamp and the list of collections.
 */
export async function extractAll( key ) {
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
		const title = rawDb.title?.[ 0 ]?.plain_text;
		return {
			id: rawDb.id,
			slug: slugify( title ),
			title,
			parent_database_id: rawDb.parent?.database_id ?? null,
			fields,
		};
	} );

	return {
		extracted_at: new Date().toISOString(),
		collections,
	};
}

/**
 * On-demand: fetch the rows for one collection. Called when the user
 * picks a collection from the list.
 *
 * @param {string} key          Notion integration key.
 * @param {string} dataSourceId The collection's data source id.
 * @return {Promise<{entries: Array}>} The transformed rows.
 */
export async function extractCollection( key, dataSourceId ) {
	const rawEntries = await fetchEntries( key, dataSourceId );
	return { entries: rawEntries.map( transformEntry ) };
}
