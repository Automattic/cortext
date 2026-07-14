import apiFetch from '@wordpress/api-fetch';
import { addQueryArgs } from '@wordpress/url';

export const TEMPLATE_POST_TYPE = 'crtxt_template';
export const TEMPLATES_EXPERIMENT_ID = 'templates';
export const TEMPLATE_KIND_PAGE = 'page';
export const TEMPLATE_KIND_ROW = 'row';

export async function fetchTemplates( { kind, collectionId } = {} ) {
	const query = {};
	if ( kind ) {
		query.kind = kind;
	}
	if ( collectionId ) {
		query.collection_id = collectionId;
	}
	const response = await apiFetch( {
		path: addQueryArgs( '/cortext/v1/templates', query ),
	} );
	return response?.templates ?? [];
}

export async function createTemplate( data = {} ) {
	const response = await apiFetch( {
		path: '/cortext/v1/templates',
		method: 'POST',
		data,
	} );
	return response?.template ?? null;
}

export async function createTemplateFromDocument( documentId ) {
	const response = await apiFetch( {
		path: '/cortext/v1/templates/from-document',
		method: 'POST',
		data: { document_id: documentId },
	} );
	return response?.template ?? null;
}

export async function updateTemplate( id, data = {} ) {
	const response = await apiFetch( {
		path: `/cortext/v1/templates/${ id }`,
		method: 'POST',
		data,
	} );
	return response?.template ?? null;
}

export async function duplicateTemplate( id ) {
	const response = await apiFetch( {
		path: `/cortext/v1/templates/${ id }/duplicate`,
		method: 'POST',
	} );
	return response?.template ?? null;
}

export async function deleteTemplate( id ) {
	return apiFetch( {
		path: `/cortext/v1/templates/${ id }`,
		method: 'DELETE',
	} );
}

export async function instantiateTemplate( id, data = {} ) {
	const response = await apiFetch( {
		path: `/cortext/v1/templates/${ id }/instantiate`,
		method: 'POST',
		data,
	} );
	return response?.document ?? null;
}

export async function fetchDefaultPageTemplate() {
	const response = await apiFetch( {
		path: '/cortext/v1/templates/default',
	} );
	return response?.template ?? null;
}

export async function setDefaultPageTemplate( id ) {
	const response = await apiFetch( {
		path: '/cortext/v1/templates/default',
		method: 'PUT',
		data: { id: id ?? null },
	} );
	return response?.template ?? null;
}
