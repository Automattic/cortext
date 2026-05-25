const TITLE_FIELD_ID = 'title';

function rawEntries( layout ) {
	const fields = layout?.fields;
	return Array.isArray( fields ) ? fields : null;
}

function normalizeStoredEntry( entry ) {
	if ( ! entry || typeof entry !== 'object' ) {
		return null;
	}
	if ( typeof entry.field !== 'string' || entry.field === '' ) {
		return null;
	}
	const field = entry.field.trim();
	if ( field === '' ) {
		return null;
	}
	return {
		field,
		visible: entry.visible !== false,
	};
}

export function normalizeDetailLayout( fields, layout ) {
	const propertyFields = Array.isArray( fields )
		? fields.filter( ( field ) => field?.id && field.id !== TITLE_FIELD_ID )
		: [];
	const fieldsById = new Map(
		propertyFields.map( ( field ) => [ field.id, field ] )
	);
	const storedEntries = rawEntries( layout );
	const seen = new Set();
	const entries = [];

	if ( storedEntries ) {
		for ( const rawEntry of storedEntries ) {
			const entry = normalizeStoredEntry( rawEntry );
			if (
				! entry ||
				seen.has( entry.field ) ||
				! fieldsById.has( entry.field )
			) {
				continue;
			}
			seen.add( entry.field );
			entries.push( entry );
		}
	}

	for ( const field of propertyFields ) {
		if ( seen.has( field.id ) ) {
			continue;
		}
		entries.push( { field: field.id, visible: true } );
		seen.add( field.id );
	}

	const allFields = entries
		.map( ( entry ) => {
			const field = fieldsById.get( entry.field );
			return field
				? { ...field, cortextDetailVisible: entry.visible }
				: null;
		} )
		.filter( Boolean );

	return {
		entries,
		allFields,
		fields: allFields.filter(
			( field ) => field.cortextDetailVisible !== false
		),
	};
}

export function detailLayoutMetaFromEntries( entries ) {
	const seen = new Set();
	return {
		fields: ( Array.isArray( entries ) ? entries : [] )
			.map( normalizeStoredEntry )
			.filter( ( entry ) => {
				if ( ! entry || seen.has( entry.field ) ) {
					return false;
				}
				seen.add( entry.field );
				return true;
			} ),
	};
}

export function detailFieldsFromEntries( fields, entries ) {
	const fieldsById = new Map(
		( Array.isArray( fields ) ? fields : [] )
			.filter( ( field ) => field?.id && field.id !== TITLE_FIELD_ID )
			.map( ( field ) => [ field.id, field ] )
	);

	return ( Array.isArray( entries ) ? entries : [] )
		.filter( ( entry ) => entry?.visible !== false )
		.map( ( entry ) => fieldsById.get( entry.field ) )
		.filter( Boolean );
}

export function reorderVisibleDetailEntries( entries, activeField, overField ) {
	const safeEntries = Array.isArray( entries ) ? entries : [];
	const visibleEntries = safeEntries.filter(
		( entry ) => entry?.visible !== false
	);
	const from = visibleEntries.findIndex(
		( entry ) => entry.field === activeField
	);
	const to = visibleEntries.findIndex(
		( entry ) => entry.field === overField
	);

	if ( from < 0 || to < 0 || from === to ) {
		return safeEntries;
	}

	const reorderedVisibleEntries = [ ...visibleEntries ];
	const [ moved ] = reorderedVisibleEntries.splice( from, 1 );
	reorderedVisibleEntries.splice( to, 0, moved );

	return safeEntries.map( ( entry ) =>
		entry?.visible === false ? entry : reorderedVisibleEntries.shift()
	);
}
