/**
 * Capability checks for a document record. Every editable record is a
 * `crtxt_document`; its UX capabilities are derived from state, not from a
 * stored type.
 */

export function hasTrait( record ) {
	const terms = record?.crtxt_trait;
	return Array.isArray( terms ) && terms.length > 0;
}

/**
 * Whether the document defines a trait (is a collection). Identity lives in
 * the mirror term, surfaced to the client as the read-only
 * `cortext_defines_trait` REST field, so an empty collection (no custom
 * fields) still reads as a collection.
 *
 * @param {Object} record Document record.
 */
export function definesTrait( record ) {
	return record?.cortext_defines_trait === true;
}

/**
 * UX feature flags for sidebar consumers. A document that defines a trait
 * (is a collection) appears in the workspace tree as a leaf; one that carries
 * a trait term lives inside its collection's data view, not in the tree at
 * all.
 *
 * @param {Object} record Document record.
 */
export function documentFeatures( record ) {
	const isCollection = definesTrait( record );
	const isRow = hasTrait( record ) && ! isCollection;
	return {
		hierarchy: ! isRow,
		canCreateChild: ! isRow && ! isCollection,
		hasOwnIcon: ! isRow,
	};
}
