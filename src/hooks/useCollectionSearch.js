import { useEntityRecords } from '@wordpress/core-data';
import { useRef } from '@wordpress/element';

import { COLLECTION_QUERY, DOCUMENT_POST_TYPE } from '../collections';
import useDebouncedValue from './useDebouncedValue';

const SEARCH_DEBOUNCE_MS = 150;

/**
 * Query for collection pickers. Searches on the server so collections past
 * the first page stay reachable, and asks only for `id` and `title`: `meta`
 * is what makes the shared collections list expensive to refetch.
 *
 * @param {string} search Search term; empty lists the first page.
 * @return {Object} REST query for `getEntityRecords`.
 */
export function collectionSearchQuery( search ) {
	const query = { ...COLLECTION_QUERY, _fields: 'id,title' };
	if ( search ) {
		query.search = search;
	}
	return query;
}

/**
 * Collections matching `search`, for pickers. Keeps the previous results
 * while the next query loads so the list does not flash empty while typing.
 *
 * @param {string} search Raw search input.
 * @return {{records: Array|null, isResolving: boolean, hasResolved: boolean}} Matches and loading state.
 */
export default function useCollectionSearch( search ) {
	const term = search.trim();
	const debouncedTerm = useDebouncedValue( term, SEARCH_DEBOUNCE_MS );
	const { records, isResolving, hasResolved } = useEntityRecords(
		'postType',
		DOCUMENT_POST_TYPE,
		collectionSearchQuery( debouncedTerm )
	);
	const lastRecords = useRef( null );
	if ( records ) {
		lastRecords.current = records;
	}

	return {
		records: records ?? lastRecords.current,
		isResolving: isResolving || term !== debouncedTerm,
		hasResolved: hasResolved && term === debouncedTerm,
	};
}
