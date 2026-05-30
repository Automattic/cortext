// ID converters between the three forms in play across the block:
//
// - DataViews row/meta keys: `field-<id>` for custom fields; `title`,
//   `created_at`, `created_by`, `modified_at`, `modified_by` for the
//   non-custom columns; `__add_field` for the ghost column.
// - Field record IDs in REST routes: numeric post IDs.
// - Collection `meta.cortext_fields` storage: stringified post IDs (the meta
//   is `'type' => 'string', 'single' => false` server-side).
//
// `toRecordId` is the gate the management UI calls before offering rename /
// duplicate / delete — non-custom columns return null and the UI hides the
// schema action affordance for them.

const FIELD_PREFIX = 'field-';

export function toRecordId( dataViewId ) {
	if ( typeof dataViewId !== 'string' ) {
		return null;
	}
	if ( ! dataViewId.startsWith( FIELD_PREFIX ) ) {
		return null;
	}
	const tail = dataViewId.slice( FIELD_PREFIX.length );
	if ( ! /^\d+$/.test( tail ) ) {
		return null;
	}
	return Number( tail );
}

export function toDataViewId( recordId ) {
	const id = Number( recordId );
	if ( ! Number.isFinite( id ) || id <= 0 ) {
		return null;
	}
	return `${ FIELD_PREFIX }${ id }`;
}

export function toMetaFieldsString( recordId ) {
	const id = Number( recordId );
	if ( ! Number.isFinite( id ) || id <= 0 ) {
		return null;
	}
	return String( id );
}
