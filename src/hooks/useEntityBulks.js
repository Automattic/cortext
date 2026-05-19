/**
 * Shared bulk queries for records the shell already lists.
 *
 * Several shell surfaces use the same records: the sidebar lists pages and
 * collections, breadcrumbs walk page parents, and collection views read fields.
 * If each surface used `useEntityRecord`, core-data could still issue per-id
 * requests for records already present in a bulk response (gutenberg#19153).
 *
 * Each helper returns the list plus a `get(id)` accessor and `hasResolved`.
 * Callers that need one record should try `get` first. If it returns null
 * after `hasResolved`, the id is outside the 100-record bulk and the caller
 * can fetch that id directly. Records outside these bulks, such as collection
 * rows and media attachments, still use `useEntityRecord`.
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
	const { records, hasResolved } = useEntityRecords(
		'postType',
		PAGE_POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const byId = useMemo(
		() => new Map( ( records ?? [] ).map( ( p ) => [ p.id, p ] ) ),
		[ records ]
	);
	const get = useCallback( ( id ) => byId.get( id ) ?? null, [ byId ] );
	return { pages: records ?? [], byId, get, hasResolved };
}

export function useCollections() {
	const { records, hasResolved } = useEntityRecords(
		'postType',
		COLLECTION_POST_TYPE,
		COLLECTION_QUERY
	);
	const get = useCallback(
		( id ) => ( records ?? [] ).find( ( c ) => c.id === id ) ?? null,
		[ records ]
	);
	return { collections: records ?? [], get, hasResolved };
}
