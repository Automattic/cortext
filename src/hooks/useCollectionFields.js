import { useMemo, useRef } from '@wordpress/element';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';

import { mapField, systemFields } from './fieldMapping';
import { normalizeDetailLayout } from './detailLayout';

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

// Reads a collection's fields from `meta.cortext_fields`: an array of
// `crtxt_field` post IDs in display order. Fetch those records, then
// map each to a DataViews field. Row meta keys are `field-<post_id>`.
export default function useCollectionFields( collectionId ) {
	const {
		record: collection,
		isResolving: collectionResolving,
		hasResolved: collectionHasResolved,
	} = useEntityRecord( 'postType', 'crtxt_document', collectionId ?? 0 );

	const fieldIds = useMemo( () => {
		const raw = collection?.meta?.cortext_fields;
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
	//
	// Core-data can return stubs (`{ id }` only) when another caller has touched
	// the records but has not hydrated them. `mapField` falls back to `#${id}`
	// without `title.raw` or `title.rendered`, which flashes raw field IDs in
	// column headers. Use the same check here and keep loading until the title
	// the table will paint is available.
	const fieldRecordsHydrated =
		Array.isArray( fieldRecords ) &&
		fieldRecords.length === fieldIds.length &&
		fieldRecords.every(
			( record ) =>
				Boolean( record?.title?.raw ) ||
				Boolean( record?.title?.rendered )
		);
	const fieldsResolvedFlag =
		fieldIds.length === 0
			? Boolean( collection )
			: ! fieldsResolving &&
			  Boolean( fieldsResolved ) &&
			  fieldRecordsHydrated;

	// Latch the last authoritative `fields` snapshot scoped to the
	// collection that produced it. When the user adds or deletes a
	// field, `meta.cortext_fields` changes, the `useEntityRecords` query gets
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
	const detailLayout = useMemo(
		() =>
			normalizeDetailLayout(
				fields,
				collection?.meta?.cortext_detail_layout
			),
		[ fields, collection?.meta?.cortext_detail_layout ]
	);

	return {
		fields,
		detailFields: detailLayout.fields,
		allDetailFields: detailLayout.allFields,
		detailLayoutEntries: detailLayout.entries,
		collection: collection ?? null,
		slug: collection?.slug ?? null,
		// True only for the first load of this collection or its field list.
		// After we have the collection and a latched field list, schema
		// refetches stay quiet so the table doesn't unmount and remount.
		// Collection 404s still work because `hasResolved` flips true on
		// failure too.
		isResolving:
			Boolean( collectionId ) &&
			( ( ! collection &&
				( collectionResolving || ! collectionHasResolved ) ) ||
				( !! collection &&
					fieldIds.length > 0 &&
					! hasStableFieldsForCollection ) ),
		fieldsResolved: fieldsResolvedFlag,
	};
}
