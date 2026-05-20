/**
 * Reads a single entity record by id, preferring an existing queried record
 * over a per-id resolver request.
 *
 * Many shell surfaces already subscribe to a queried list of records (active
 * pages, collections, etc.). When another component needs one record from
 * that same query, `useEntityRecord` would still fire its own request
 * because the per-id resolver tracks resolution separately from the queried
 * selector (gutenberg#19153). This hook hands back the record from the
 * shared query when possible, and only falls back to a targeted
 * `useEntityRecord` once the query has resolved without that id, so the
 * common path stays fetch-free.
 *
 * The `query` argument should be the same object identity used by the
 * sibling surfaces that own the queried subscription, so core-data
 * collapses the underlying network request.
 */

import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useMemo } from '@wordpress/element';

export default function usePooledEntityRecord( kind, name, query, id ) {
	const { records, hasResolved } = useEntityRecords( kind, name, query );

	const fromQuery = useMemo( () => {
		if ( ! id ) {
			return null;
		}
		return ( records ?? [] ).find( ( record ) => record.id === id ) ?? null;
	}, [ records, id ] );

	const missingFromQuery = Boolean( id ) && hasResolved && fromQuery === null;
	const { record: fallback } = useEntityRecord( kind, name, id ?? 0, {
		enabled: missingFromQuery,
	} );

	const record = useMemo( () => {
		if ( fromQuery ) {
			return fromQuery;
		}
		if ( fallback && fallback.id === id ) {
			return fallback;
		}
		return null;
	}, [ fromQuery, fallback, id ] );

	return { hasResolved, record };
}
