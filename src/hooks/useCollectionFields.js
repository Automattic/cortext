import { useMemo, useRef } from '@wordpress/element';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';

import { mapField, systemFields } from './fieldMapping';

// Shared field-list query shape. Exported so mutation hooks can invalidate
// the exact resolver used here without copy-pasting the parameters and
// drifting out of sync. Does not include `include`, which is per-collection.
export const FIELD_LIST_QUERY_BASE = {
	per_page: 100,
	orderby: 'include',
	// `crtxt_field` posts are stored as `private`; without an explicit
	// `status` REST defaults to `publish` and returns zero rows.
	status: [ 'draft', 'private', 'publish' ],
	context: 'edit',
};

export function buildFieldListQuery( fieldIds ) {
	return { include: fieldIds, ...FIELD_LIST_QUERY_BASE };
}

// Reads a collection's fields from main's contract: `meta.fields` is an array
// of `crtxt_field` post IDs in display order. Fetch those records, then
// map each to a DataViews field. Row meta keys are `field-<post_id>`.
export default function useCollectionFields( collectionId ) {
	const {
		record: collection,
		isResolving: collectionResolving,
		hasResolved: collectionHasResolved,
	} = useEntityRecord( 'postType', 'crtxt_collection', collectionId ?? 0 );

	const fieldIds = useMemo( () => {
		const raw = collection?.meta?.fields;
		if ( ! Array.isArray( raw ) ) {
			return [];
		}
		return raw.map( ( id ) => Number( id ) ).filter( Boolean );
	}, [ collection ] );

	const {
		records: fieldRecords,
		isResolving: fieldsResolving,
		hasResolved: fieldsResolved,
	} = useEntityRecords(
		'postType',
		'crtxt_field',
		buildFieldListQuery( fieldIds ),
		// Skip the resolver when there are no IDs to look up. Passing
		// `undefined`/`{}` would fall through to a default empty query,
		// which fetches every `crtxt_field` in the system.
		{ enabled: fieldIds.length > 0 }
	);

	const liveFields = useMemo( () => {
		const custom = Array.isArray( fieldRecords )
			? fieldRecords.map( mapField )
			: [];
		// System fields (created/modified timestamps + authors) sit at
		// the bottom of the column visibility menu, default-hidden via
		// `editable: false`. The REST controller injects their values
		// into each row payload in `format_row`.
		return [ ...custom, ...systemFields() ];
	}, [ fieldRecords ] );

	// `isResolving` flips true only while we're actively fetching AND
	// have no record yet. After a 404 (resolution finishes with no
	// collection) `collectionResolving` flips back to false, so the
	// consumer can fall through to the invalid-collection notice
	// instead of spinning forever. During a refetch (after a mutation)
	// the cached collection stays truthy, so the spinner doesn't
	// flash even though the resolver briefly enters the resolving
	// state.
	//
	// `fieldsResolved` lets the view-sync wait for authoritative field
	// data before running. During a refetch (e.g., after creating a
	// field) `fieldRecords` briefly returns an empty array; without this
	// guard the sync would treat all custom fields as "removed" and
	// strip them from `view.fields`.
	const fieldsResolvedFlag =
		fieldIds.length === 0
			? Boolean( collection )
			: ! fieldsResolving && Boolean( fieldsResolved );

	// Latch the last authoritative `fields` snapshot scoped to the
	// collection that produced it. When the user adds or deletes a
	// field, `meta.fields` changes, the `useEntityRecords` query gets
	// a new `include`, and core-data's `hasResolved` flips back to
	// false until that query settles. Storing the previous fields keeps
	// `dataViewFields` populated through the transient and lets
	// `isResolving` stay false (no spinner flash). The collectionId
	// pairing makes sure a collection switch reverts to the loading
	// state rather than reusing the previous collection's fields.
	const stableRef = useRef( { collectionId: null, fields: null } );
	if ( fieldsResolvedFlag && collectionId ) {
		stableRef.current = { collectionId, fields: liveFields };
	}
	const hasStableFieldsForCollection =
		stableRef.current.collectionId === collectionId &&
		stableRef.current.fields !== null;
	const fields = hasStableFieldsForCollection
		? stableRef.current.fields
		: liveFields;

	return {
		fields,
		collection: collection ?? null,
		slug: collection?.meta?.slug ?? null,
		// True while either the collection or the field list is still on
		// its first resolution for this collection. Once we've latched
		// fields for the current collection (`hasStableFieldsForCollection`),
		// subsequent refetches (after a mutation that changes the field
		// list) keep this false so the table doesn't unmount and remount.
		// The collection 404 path stays handled because `hasResolved` flips
		// to true on resolution failure too, dropping us back to the normal
		// path so the invalid-collection notice renders.
		isResolving:
			Boolean( collectionId ) &&
			( ! collectionHasResolved ||
				( ! collection && collectionResolving ) ||
				( !! collection &&
					fieldIds.length > 0 &&
					! hasStableFieldsForCollection ) ),
		fieldsResolved: fieldsResolvedFlag,
	};
}
