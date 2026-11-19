import computeCascadeRoots from '../computeCascadeRoots';

// Mirror the PHP `TrashCascade` markers. The cascade stamps a different key
// depending on whether the descendant was trashed as a child page or as a row
// of a collection, but the value carries the same meaning ("trashed by this
// document"), so either marker points back to the cascade root.
export const TRASH_MARKER_META_KEYS = [
	'_cortext_trashed_by_parent',
	'_cortext_trashed_by_collection',
];

export function computeTrashRoots( trashedDocuments = [] ) {
	return computeCascadeRoots( trashedDocuments, TRASH_MARKER_META_KEYS );
}
