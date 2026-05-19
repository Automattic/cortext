/**
 * Canonical bulk queries for entities the shell shows in lists or trees.
 *
 * Cortext renders many surfaces that depend on the same small set of entities:
 * the sidebar lists every active page and every collection, the breadcrumb
 * walks page parents, the Canvas opens a page or row, collection views read
 * fields. Each of these surfaces would issue its own per-id fetch if it used
 * `useEntityRecord` directly, even though the matching bulk has already
 * cached the record. WordPress core-data's per-id resolver does not share
 * resolution state with the bulk resolver (gutenberg#19153), so we route
 * single-record reads through the bulks below instead.
 *
 * Each helper returns the full list plus a `get(id)` accessor. Callers that
 * need the array (chain traversal, listing) read `records`; callers that
 * only need one record by id call `get`.
 *
 * Entities that are not covered by any bulk (rows inside a collection, media
 * attachments) still go through `useEntityRecord` at the call site. There is
 * no fallback fetch when the bulk does not contain the requested id; the
 * caller decides how to render that (typically: render nothing).
 */

import { useEntityRecords } from '@wordpress/core-data';
import { useCallback, useMemo } from '@wordpress/element';

import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE as PAGE_POST_TYPE,
} from '../components/page-queries';
import { COLLECTION_QUERY } from '../collections';

const COLLECTION_POST_TYPE = 'crtxt_collection';

export function useActivePages() {
	const { records } = useEntityRecords(
		'postType',
		PAGE_POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const byId = useMemo(
		() => new Map( ( records ?? [] ).map( ( p ) => [ p.id, p ] ) ),
		[ records ]
	);
	const get = useCallback( ( id ) => byId.get( id ) ?? null, [ byId ] );
	return { pages: records ?? [], byId, get };
}

export function useCollections() {
	const { records } = useEntityRecords(
		'postType',
		COLLECTION_POST_TYPE,
		COLLECTION_QUERY
	);
	const get = useCallback(
		( id ) => ( records ?? [] ).find( ( c ) => c.id === id ) ?? null,
		[ records ]
	);
	return { collections: records ?? [], get };
}
