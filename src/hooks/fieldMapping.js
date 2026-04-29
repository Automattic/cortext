import EditableCell from '../components/EditableCell';

// Parses stored option records into the DataViews `elements` shape.
// Accepts a string shorthand (`'red'` becomes `{ value: 'red', label: 'red' }`)
// or `{ value, label, color? }`. `color` is an optional CSS color the chip
// renderer reads.
export function elementsFromOptions( raw ) {
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
		const value = option.value ?? '';
		const label = option.label ?? option.value ?? '';
		const element = { value, label };
		if ( option.color ) {
			element.color = option.color;
		}
		return element;
	} );
}

// Cortext field types that this client knows how to edit inline. Anything
// outside this set (formula, rollup, relation, …) renders read-only — see
// `EditableCell`'s `readOnly` branch.
export const EDITABLE_TYPES = new Set( [
	'text',
	'number',
	'email',
	'url',
	'select',
	'multiselect',
	'date',
	'datetime',
	'checkbox',
] );

function buildRender( id, type, label, elements ) {
	const readOnly = ! EDITABLE_TYPES.has( type );
	return ( { item } ) => (
		<EditableCell
			item={ item }
			fieldId={ id }
			fieldType={ type }
			elements={ elements }
			label={ label }
			readOnly={ readOnly }
		/>
	);
}

export function mapField( field ) {
	const id = `field-${ field.id }`;
	const label = field.title?.rendered || field.title?.raw || `#${ field.id }`;
	const type = field.meta?.type ?? 'text';
	const elements = elementsFromOptions( field.meta?.options );
	const base = {
		id,
		label,
		getValue: ( { item } ) => item?.meta?.[ id ] ?? null,
		render: buildRender( id, type, label, elements ),
		editable: EDITABLE_TYPES.has( type ),
	};

	// DataViews v6's FieldType union is
	// `'text' | 'integer' | 'datetime' | 'date' | 'media' | 'boolean' | 'email' | 'array'`.
	// EditableCell drives the actual edit/display, so these mappings only
	// affect column-level metadata (default sort comparator, future filter
	// UI). We pick the closest honest type rather than the prettiest one:
	// numbers go through 'text' because 'integer' rejects decimals at sort
	// time, multiselect goes through 'array' so DataViews understands the
	// value cardinality.
	switch ( type ) {
		case 'number':
			return { ...base, type: 'text' };
		case 'email':
			return { ...base, type: 'email' };
		case 'url':
			return { ...base, type: 'text' };
		case 'select':
			return { ...base, type: 'text', elements };
		case 'multiselect':
			return { ...base, type: 'array', elements };
		case 'date':
		case 'datetime':
			return { ...base, type: 'datetime' };
		case 'checkbox':
			return { ...base, type: 'boolean' };
		case 'text':
		default:
			return { ...base, type: 'text' };
	}
}
