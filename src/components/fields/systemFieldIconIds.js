export const SYSTEM_FIELD_ICON_IDS = new Set( [
	'created_at',
	'created_by',
	'modified_at',
	'modified_by',
] );

export function hasSystemFieldIcon( fieldId ) {
	return SYSTEM_FIELD_ICON_IDS.has( fieldId );
}
