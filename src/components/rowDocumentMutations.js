import { DOCUMENT_POST_TYPE } from '../collections';
import { TITLE_FIELD_ID } from './dataViewColumns';

export function rowDocumentFieldPayload( fieldId, value ) {
	if ( fieldId === TITLE_FIELD_ID ) {
		return { title: value ?? '' };
	}

	return { meta: { [ fieldId ]: value } };
}

export function saveRowDocumentField(
	saveEntityRecord,
	rowId,
	fieldId,
	value
) {
	return saveEntityRecord(
		'postType',
		DOCUMENT_POST_TYPE,
		{
			id: rowId,
			...rowDocumentFieldPayload( fieldId, value ),
		},
		{ throwOnError: true }
	);
}
