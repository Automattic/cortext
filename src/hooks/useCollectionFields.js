import { useMemo } from '@wordpress/element';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';

function elementsFromOptions( raw ) {
	if ( ! raw ) {
		return undefined;
	}
	let options;
	try {
		options = typeof raw === 'string' ? JSON.parse( raw ) : raw;
	} catch {
		return undefined;
	}
	if ( ! Array.isArray( options ) ) {
		return undefined;
	}
	return options.map( ( option ) => {
		if ( typeof option === 'string' ) {
			return { value: option, label: option };
		}
		return {
			value: option.value ?? option.key ?? '',
			label: option.label ?? option.value ?? '',
		};
	} );
}

function mapField( field ) {
	const id = `field-${ field.id }`;
	const label = field.title?.rendered || field.title?.raw || `#${ field.id }`;
	const type = field.meta?.type ?? 'text';
	const base = {
		id,
		label,
		getValue: ( { item } ) => item?.meta?.[ id ] ?? null,
	};

	switch ( type ) {
		case 'number':
			return { ...base, type: 'integer' };
		case 'email':
			return { ...base, type: 'email' };
		case 'url':
			return { ...base, type: 'text' };
		case 'select':
			return {
				...base,
				type: 'text',
				elements: elementsFromOptions( field.meta?.options ),
			};
		case 'multiselect':
			return {
				...base,
				type: 'text',
				elements: elementsFromOptions( field.meta?.options ),
				isMultiple: true,
			};
		case 'date':
		case 'datetime':
			return { ...base, type: 'datetime' };
		case 'checkbox':
			return { ...base, type: 'text' };
		case 'text':
		default:
			return { ...base, type: 'text' };
	}
}

// Reads a collection's fields from main's contract: `meta.fields` is an array
// of `cortext_field` post IDs in display order. Fetch those records, then
// map each to a DataViews field. Row meta keys are `field-<post_id>`.
export default function useCollectionFields( collectionId ) {
	const { record: collection, isResolving: collectionResolving } =
		useEntityRecord( 'postType', 'cortext_collection', collectionId ?? 0 );

	const fieldIds = useMemo( () => {
		const raw = collection?.meta?.fields;
		if ( ! Array.isArray( raw ) ) {
			return [];
		}
		return raw.map( ( id ) => Number( id ) ).filter( Boolean );
	}, [ collection ] );

	const { records: fieldRecords, isResolving: fieldsResolving } =
		useEntityRecords(
			'postType',
			'cortext_field',
			{
				include: fieldIds,
				per_page: 100,
				orderby: 'include',
				// `cortext_field` posts are stored as `private`; without an
				// explicit `status` REST defaults to `publish` and returns
				// zero rows.
				status: [ 'draft', 'private', 'publish' ],
				context: 'edit',
			},
			// Skip the resolver when there are no IDs to look up. Passing
			// `undefined`/`{}` would fall through to a default empty query,
			// which fetches every `cortext_field` in the system.
			{ enabled: fieldIds.length > 0 }
		);

	const fields = useMemo( () => {
		if ( ! Array.isArray( fieldRecords ) ) {
			return [];
		}
		return fieldRecords.map( mapField );
	}, [ fieldRecords ] );

	return {
		fields,
		collection: collection ?? null,
		slug: collection?.meta?.slug ?? null,
		isResolving:
			Boolean( collectionId ) &&
			( collectionResolving ||
				( fieldIds.length > 0 && fieldsResolving ) ),
	};
}
