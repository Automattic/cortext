/**
 * Read-only field mapping for the public frontend.
 *
 * Takes the lightweight field definitions from the REST response
 * ({ id, label, type, options }) and produces DataViews field specs
 * with read-only renderers. No EditableCell, no editor dependencies.
 */

import { __ } from '@wordpress/i18n';

import { elementsFromOptions } from './fieldMapping';
import { formatDisplay } from '../utils/formatDisplay';

const TITLE_FIELD = {
	id: 'title',
	label: __( 'Title', 'cortext' ),
	type: 'text',
	enableGlobalSearch: true,
	enableHiding: false,
	getValue: ( { item } ) => item?.title?.rendered ?? '',
	render: ( { item } ) => item?.title?.rendered ?? '',
};

const COVER_FIELD = {
	id: 'cover',
	label: __( 'Cover', 'cortext' ),
	type: 'media',
	enableGlobalSearch: false,
	enableSorting: false,
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
		enableSorting: true,
		getValue: ( { item } ) => item?.created_at ?? '',
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
		enableGlobalSearch: false,
		enableSorting: false,
		getValue: ( { item } ) => item?.created_by ?? '',
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
		enableSorting: true,
		getValue: ( { item } ) => item?.modified_at ?? '',
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
		enableGlobalSearch: false,
		enableSorting: false,
		getValue: ( { item } ) => item?.modified_by ?? '',
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
	return entry?.title?.raw || entry?.title?.rendered || `#${ entry?.id }`;
}

function formatPublicRelation( value ) {
	const refs = Array.isArray( value ) ? value : [ value ];
	return refs.map( relationTitle ).filter( Boolean ).join( ', ' );
}

function formatPublicDisplay( value, type, elements ) {
	if ( type === 'relation' ) {
		return formatPublicRelation( value );
	}
	return formatDisplay( value, type, elements );
}

function publicValue( value, type ) {
	if ( type === 'relation' ) {
		return formatPublicRelation( value );
	}
	return value;
}

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
	const elements = elementsFromOptions( fieldDef.options );

	const base = {
		id,
		label,
		getValue: ( { item } ) =>
			publicValue( item?.meta?.[ id ] ?? null, type ),
		render: ( { item } ) =>
			formatPublicDisplay( item?.meta?.[ id ] ?? null, type, elements ),
	};

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
		case 'relation':
			return { ...base, type: 'text', enableSorting: false };
		case 'text':
		default:
			return { ...base, type: 'text' };
	}
}

/**
 * Builds the full field list for a public DataViews instance.
 *
 * Returns every available field — DataViews uses `view.fields` to
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
