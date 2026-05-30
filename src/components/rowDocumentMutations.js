import apiFetch from '@wordpress/api-fetch';

import { TITLE_FIELD_ID } from './dataViewColumns';

export function rowDocumentFieldPayload( fieldId, value ) {
	if ( fieldId === TITLE_FIELD_ID ) {
		return { title: value ?? '' };
	}

	return { meta: { [ fieldId ]: value } };
}

export function saveRowDocumentField( rowId, fieldId, value ) {
	return apiFetch( {
		path: `/wp/v2/crtxt_documents/${ rowId }`,
		method: 'POST',
		data: rowDocumentFieldPayload( fieldId, value ),
	} );
}
