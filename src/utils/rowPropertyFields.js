// Reads a row's properties (its collection's fields plus the system fields)
// straight from core-data, for code that runs outside React, such as a
// block bindings source. Uses the same queries as `useCollectionFields`, so
// both share one cache.
import { store as coreStore } from '@wordpress/core-data';

import { DOCUMENT_POST_TYPE as POST_TYPE } from '../collections';
import { buildFieldListQuery } from '../hooks/useCollectionFields';
import { mapField, systemFields } from '../hooks/fieldMapping';

const TRAIT_TAXONOMY = 'crtxt_trait';

// Mapped fields per field-record list, so repeated selects return the same
// array until core-data hands back new records.
const mappedFieldsByRecords = new WeakMap();

/**
 * Returns the row's property fields, or an empty list while they resolve or
 * when the document isn't a row.
 *
 * @param {Function} select Registry `select`.
 * @param {number}   postId Row post ID.
 * @return {Object[]} Fields from `mapField`, followed by `systemFields()`.
 */
export function selectRowPropertyFields( select, postId ) {
	const { getEditedEntityRecord, getEntityRecord, getEntityRecords } =
		select( coreStore );
	const row = getEditedEntityRecord( 'postType', POST_TYPE, postId );
	const termId = Number( row?.crtxt_trait?.[ 0 ] );
	if ( ! termId ) {
		return [];
	}
	// The mirror term's slug is the collection's post ID.
	const collectionId = Number(
		getEntityRecord( 'taxonomy', TRAIT_TAXONOMY, termId )?.slug
	);
	if ( ! collectionId ) {
		return [];
	}
	const fieldIds = (
		getEntityRecord( 'postType', POST_TYPE, collectionId )?.meta
			?.cortext_fields ?? []
	)
		.map( Number )
		.filter( Boolean );
	const records =
		fieldIds.length > 0
			? getEntityRecords(
					'postType',
					'crtxt_field',
					buildFieldListQuery( fieldIds )
			  )
			: [];
	if ( ! Array.isArray( records ) ) {
		return [];
	}
	if ( ! mappedFieldsByRecords.has( records ) ) {
		mappedFieldsByRecords.set( records, [
			...records.map( mapField ),
			...systemFields(),
		] );
	}
	return mappedFieldsByRecords.get( records );
}
