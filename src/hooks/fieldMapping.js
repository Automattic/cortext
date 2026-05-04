import { __ } from '@wordpress/i18n';
import { dateI18n } from '@wordpress/date';

import EditableCell from '../components/EditableCell';

// Parses stored option records into the DataViews `elements` shape.
// Accepts a string shorthand (`'red'` becomes `{ value: 'red', label: 'red' }`)
// or `{ value, label, color? }`. `color` is an optional CSS color the chip
// renderer reads — tech-debt.md#11: DataViews's `Option` type doesn't
// declare `color`, but it tolerates extra keys on element entries.
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

const SEARCHABLE_TYPES = new Set( [ 'text', 'email', 'url' ] );

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

function HeaderLabel( { children } ) {
	return <span className="cortext-column-header-label">{ children }</span>;
}

// Returns the four read-only system fields surfaced alongside each
// collection's custom fields: created at, last edited at, created by,
// last edited by. The values come straight off the row payload (the
// REST controller injects them in `format_row`); these definitions just
// describe how they're rendered and which ones are sortable.
//
// `editable: false` keeps them out of the default `view.fields` seed
// (CollectionDataViews seeds editable columns only), so they appear in
// the column visibility menu default-hidden, addable like any other
// field. Sort is enabled only on the timestamps — sort on display-value
// properties (Person, Relation, Rollup) is an open architectural
// decision shared with relations and rollups (tech-debt.md#14).
export function systemFields() {
	const formatDate = ( value ) =>
		value ? dateI18n( 'M j, Y g:i a', value ) : '';
	const formatText = ( value ) => ( value ? String( value ) : '' );

	return [
		{
			id: 'created_at',
			label: __( 'Created', 'cortext' ),
			type: 'datetime',
			editable: false,
			enableSorting: true,
			getValue: ( { item } ) => item?.created_at ?? null,
			render: ( { item } ) => (
				<span className="cortext-cell-readonly">
					{ formatDate( item?.created_at ) }
				</span>
			),
		},
		{
			id: 'created_by',
			label: __( 'Created by', 'cortext' ),
			type: 'text',
			editable: false,
			enableSorting: false,
			getValue: ( { item } ) => item?.created_by ?? null,
			render: ( { item } ) => (
				<span className="cortext-cell-readonly">
					{ formatText( item?.created_by ) }
				</span>
			),
		},
		{
			id: 'modified_at',
			label: __( 'Last edited', 'cortext' ),
			type: 'datetime',
			editable: false,
			enableSorting: true,
			getValue: ( { item } ) => item?.modified_at ?? null,
			render: ( { item } ) => (
				<span className="cortext-cell-readonly">
					{ formatDate( item?.modified_at ) }
				</span>
			),
		},
		{
			id: 'modified_by',
			label: __( 'Last edited by', 'cortext' ),
			type: 'text',
			editable: false,
			enableSorting: false,
			getValue: ( { item } ) => item?.modified_by ?? null,
			render: ( { item } ) => (
				<span className="cortext-cell-readonly">
					{ formatText( item?.modified_by ) }
				</span>
			),
		},
	];
}

export function mapField( field ) {
	const id = `field-${ field.id }`;
	// Prefer `title.raw` over `title.rendered`: the latter has the
	// `the_title` filter applied (wptexturize, entity encoding), which
	// turns `&` into `&#038;`. We render the label as a JSX text child
	// (auto-escaped by React), so the entity layer is unwanted noise.
	const label = field.title?.raw || field.title?.rendered || `#${ field.id }`;
	const type = field.meta?.type ?? 'text';
	const elements = elementsFromOptions( field.meta?.options );
	const base = {
		id,
		label,
		// Header content is just an aria-hidden marker.
		// `ColumnHeaderActions` queries the DOM for it and portals our
		// combined-dropdown trigger into the owning <th>; DataViews'
		// built-in trigger is hidden via CSS on marker-bearing columns
		// (tech-debt.md#16). Skipping the label here avoids leaking
		// duplicate text into the th's accessible/text content.
		header: (
			<HeaderLabel>
				<span
					className="cortext-column-header-marker"
					data-cortext-field-marker={ field.id }
					aria-hidden="true"
				/>
			</HeaderLabel>
		),
		getValue: ( { item } ) => item?.meta?.[ id ] ?? null,
		render: buildRender( id, type, label, elements ),
		editable: EDITABLE_TYPES.has( type ),
		enableGlobalSearch: SEARCHABLE_TYPES.has( type ),
	};

	// DataViews v6's FieldType union is
	// `'text' | 'integer' | 'datetime' | 'date' | 'media' | 'boolean' | 'email' | 'array'`.
	// EditableCell drives the actual edit/display, so these mappings only
	// affect column-level metadata (default sort comparator, future filter
	// UI). We pick the closest honest type rather than the prettiest one:
	// numbers and url go through 'text' because there's nothing closer
	// (tech-debt.md#10), multiselect goes through 'array' so DataViews
	// understands the value cardinality.
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
