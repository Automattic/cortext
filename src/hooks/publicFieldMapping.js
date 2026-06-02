/**
 * Read-only field mapping for the public frontend.
 *
 * Takes the lightweight field definitions from the REST response
 * ({ id, label, type, options }) and produces DataViews field specs
 * with read-only renderers. No EditableCell, no editor dependencies.
 */

import { __ } from '@wordpress/i18n';

import { dataViewsFilterByForType, elementsFromOptions } from './fieldMapping';
import { formatDisplay } from '../utils/formatDisplay';

const PUBLIC_SEARCHABLE_TYPES = new Set( [
	'text',
	'email',
	'url',
	'select',
	'multiselect',
	'relation',
	'rollup',
] );
const PUBLIC_FILTER_OPERATORS = {
	text: [ 'is', 'isNot', 'contains', 'notContains', 'startsWith' ],
	email: [ 'is', 'isNot', 'contains', 'notContains', 'startsWith' ],
	url: [ 'is', 'isNot', 'contains', 'notContains', 'startsWith' ],
	number: [ 'is', 'greaterThan', 'lessThan', 'between' ],
	date: [ 'on', 'before', 'after', 'between' ],
	datetime: [ 'on', 'before', 'after' ],
	select: [ 'isAny', 'isNone' ],
	multiselect: [ 'isAny', 'isNone' ],
};

function publicFilterByForType( type ) {
	return dataViewsFilterByForType(
		type,
		PUBLIC_FILTER_OPERATORS[ type ] ?? []
	);
}

function isPublicSearchable( type ) {
	return PUBLIC_SEARCHABLE_TYPES.has( type );
}

const TITLE_FIELD = {
	id: 'title',
	label: __( 'Title', 'cortext' ),
	type: 'text',
	enableGlobalSearch: true,
	enableHiding: false,
	enableSorting: false,
	filterBy: publicFilterByForType( 'text' ),
	getValue: ( { item } ) => textValue( item?.title?.rendered ),
	render: ( { item } ) => item?.title?.rendered ?? '',
};

const COVER_FIELD = {
	id: 'cover',
	label: __( 'Cover', 'cortext' ),
	type: 'media',
	enableGlobalSearch: false,
	enableSorting: false,
	filterBy: false,
	getValue: ( { item } ) => item?.cover?.url ?? '',
	render: ( { item } ) => {
		const cover = item?.cover;
		if ( ! cover?.url ) {
			return null;
		}
		return <img src={ cover.url } alt={ cover.alt ?? '' } loading="lazy" />;
	},
};

const SYSTEM_FIELDS = [
	{
		id: 'created_at',
		label: __( 'Created', 'cortext' ),
		type: 'datetime',
		enableGlobalSearch: false,
		enableSorting: false,
		filterBy: false,
		getValue: ( { item } ) => textValue( item?.created_at ),
		render: ( { item } ) => {
			const value = item?.created_at;
			if ( ! value ) {
				return '';
			}
			const date = new Date( value );
			return Number.isNaN( date.getTime() )
				? ''
				: date.toLocaleDateString();
		},
	},
	{
		id: 'created_by',
		label: __( 'Created by', 'cortext' ),
		type: 'text',
		enableGlobalSearch: true,
		enableSorting: false,
		filterBy: publicFilterByForType( 'text' ),
		getValue: ( { item } ) => textValue( item?.created_by ),
		render: ( { item } ) => (
			<span className="cortext-cell-readonly">
				{ item?.created_by ? String( item.created_by ) : '' }
			</span>
		),
	},
	{
		id: 'modified_at',
		label: __( 'Last edited', 'cortext' ),
		type: 'datetime',
		enableGlobalSearch: false,
		enableSorting: false,
		filterBy: false,
		getValue: ( { item } ) => textValue( item?.modified_at ),
		render: ( { item } ) => {
			const value = item?.modified_at;
			if ( ! value ) {
				return '';
			}
			const date = new Date( value );
			return Number.isNaN( date.getTime() )
				? ''
				: date.toLocaleDateString();
		},
	},
	{
		id: 'modified_by',
		label: __( 'Last edited by', 'cortext' ),
		type: 'text',
		enableGlobalSearch: true,
		enableSorting: false,
		filterBy: publicFilterByForType( 'text' ),
		getValue: ( { item } ) => textValue( item?.modified_by ),
		render: ( { item } ) => (
			<span className="cortext-cell-readonly">
				{ item?.modified_by ? String( item.modified_by ) : '' }
			</span>
		),
	},
];

function relationTitle( entry ) {
	if ( ! entry ) {
		return '';
	}
	if ( typeof entry !== 'object' ) {
		return String( entry );
	}
	return (
		entry?.title?.raw ||
		entry?.title?.rendered ||
		( entry?.id ? `#${ entry.id }` : '' )
	);
}

function formatPublicRelation( value ) {
	const refs = Array.isArray( value ) ? value : [ value ];
	return refs.map( relationTitle ).filter( Boolean ).join( ', ' );
}

function formatPublicDisplay( value, type, elements ) {
	if ( type === 'relation' ) {
		return formatPublicRelation( value );
	}
	if ( type === 'rollup' ) {
		// Date-range rollups arrive as a { start, end } object.
		if (
			value &&
			typeof value === 'object' &&
			! Array.isArray( value ) &&
			( 'start' in value || 'end' in value )
		) {
			return formatDisplay( value, 'rollup-date-range' );
		}
		// Other rollups are a scalar or an array of the target field's
		// values. An array can hold relation references (objects), which
		// formatDisplay stringifies to "[object Object]". textValue reads
		// their titles instead.
		return textValue( value );
	}
	return formatDisplay( value, type, elements );
}

function textValue( value ) {
	if ( value === null || value === undefined ) {
		return '';
	}
	if ( Array.isArray( value ) ) {
		return value.map( textValue ).filter( Boolean ).join( ', ' );
	}
	if ( typeof value === 'object' ) {
		return relationTitle( value );
	}
	return String( value );
}

function arrayValue( value ) {
	const list = Array.isArray( value ) ? value : [ value ];
	return list.map( textValue ).filter( Boolean );
}

function numberValue( value ) {
	if ( value === null || value === undefined || value === '' ) {
		return '';
	}
	if ( typeof value === 'number' ) {
		return Number.isFinite( value ) ? value : '';
	}
	if ( typeof value === 'string' ) {
		const trimmed = value.trim();
		if ( trimmed === '' ) {
			return '';
		}
		const number = Number( trimmed );
		return Number.isFinite( number ) ? number : value;
	}
	return textValue( value );
}

function publicValue( value, type ) {
	switch ( type ) {
		case 'relation':
			return formatPublicRelation( value );
		case 'multiselect':
			return arrayValue( value );
		case 'checkbox':
			return value === true;
		case 'number':
			return numberValue( value );
		case 'text':
		case 'email':
		case 'url':
		case 'select':
		case 'date':
		case 'datetime':
		default:
			return textValue( value );
	}
}

const FORMULA_RESULT_TYPES = new Set( [
	'text',
	'number',
	'date',
	'datetime',
	'checkbox',
] );

/**
 * Builds a DataViews-compatible field spec from a REST field definition.
 *
 * @param {Object}      fieldDef         Field definition from the REST response.
 * @param {number}      fieldDef.id
 * @param {string}      fieldDef.label
 * @param {string}      fieldDef.type
 * @param {string|null} fieldDef.options JSON-encoded options string.
 * @return {Object} DataViews field spec.
 */
function mapPublicField( fieldDef ) {
	const id = `field-${ fieldDef.id }`;
	const { label, type } = fieldDef;
	let displayType = type;
	if ( type === 'formula' ) {
		displayType = FORMULA_RESULT_TYPES.has( fieldDef.formulaResultType )
			? fieldDef.formulaResultType
			: 'text';
	}
	const elements = elementsFromOptions( fieldDef.options );

	const base = {
		id,
		label,
		enableSorting: false,
		enableGlobalSearch: isPublicSearchable( displayType ),
		filterBy: publicFilterByForType( displayType ),
		getValue: ( { item } ) =>
			publicValue( item?.meta?.[ id ] ?? null, displayType ),
		render: ( { item } ) =>
			formatPublicDisplay(
				item?.meta?.[ id ] ?? null,
				displayType,
				elements
			),
	};

	switch ( displayType ) {
		case 'number':
			return {
				...base,
				type: 'text',
			};
		case 'email':
			return {
				...base,
				type: 'email',
			};
		case 'url':
			return {
				...base,
				type: 'text',
			};
		case 'select':
			return {
				...base,
				type: 'text',
				elements,
			};
		case 'multiselect':
			return {
				...base,
				type: 'array',
				elements,
			};
		case 'date':
		case 'datetime':
			return {
				...base,
				type: 'datetime',
			};
		case 'checkbox':
			return {
				...base,
				type: 'boolean',
			};
		case 'relation':
			return {
				...base,
				type: 'text',
				filterBy: false,
			};
		case 'rollup':
			return {
				...base,
				type: 'text',
				filterBy: false,
			};
		case 'text':
		default:
			return {
				...base,
				type: 'text',
			};
	}
}

/**
 * Builds the full field list for a public DataViews instance.
 *
 * Returns every available field. DataViews uses `view.fields` to
 * control which columns are visible. Pre-filtering here would cause
 * hidden fields to disappear from the field-visibility settings.
 *
 * @param {Array} fieldDefs Field definitions from the REST response.
 * @return {Object[]} DataViews field specs.
 */
export function buildPublicFields( fieldDefs ) {
	const customFields = fieldDefs.map( mapPublicField );
	return [ TITLE_FIELD, COVER_FIELD, ...customFields, ...SYSTEM_FIELDS ];
}
