/**
 * Reads one entity record by id. If the id is part of a query the shell
 * already runs, the record comes from that shared subscription. If not,
 * the hook only fetches it once the query has resolved without it.
 *
 * Why: core-data's per-id and queried resolvers track resolution separately
 * (gutenberg#19153), so calling `useEntityRecord` for a record already in a
 * queried response still fires another request. Routing single-record reads
 * through this hook avoids that as long as the same `query` identity reaches
 * sibling subscribers.
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
