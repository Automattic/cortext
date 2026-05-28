/**
 * Capability checks for a document record. Every editable record is a
 * `crtxt_document`; its UX capabilities are derived from state, not from a
 * stored type.
 */

export function hasFields( record ) {
	const ids = record?.meta?.cortext_fields;
	return Array.isArray( ids ) && ids.length > 0;
}

export function hasTrait( record ) {
	const terms = record?.crtxt_trait;
	return Array.isArray( terms ) && terms.length > 0;
}

/**
 * UX feature flags for sidebar consumers. A document that defines a schema
 * (`cortext_fields`) appears in the workspace tree as a leaf; one that
 * carries a trait term lives inside its collection's data view, not in the
 * tree at all.
 *
 * @param {Object} record Document record.
 */
export function documentFeatures( record ) {
	const isCollection = hasFields( record );
	const isRow = hasTrait( record ) && ! isCollection;
	return {
		hierarchy: ! isRow,
		canCreateChild: ! isRow && ! isCollection,
		hasOwnIcon: ! isRow,
	};
}
