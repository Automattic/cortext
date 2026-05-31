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
	getValue: ( { item } ) => textValue( item?.title?.rendered ),
	sort: sortTextValues( ( { item } ) => textValue( item?.title?.rendered ) ),
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
		getValue: ( { item } ) => textValue( item?.created_at ),
		sort: sortDateValues( ( { item } ) => textValue( item?.created_at ) ),
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
		getValue: ( { item } ) => textValue( item?.created_by ),
		sort: sortTextValues( ( { item } ) => textValue( item?.created_by ) ),
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
		getValue: ( { item } ) => textValue( item?.modified_at ),
		sort: sortDateValues( ( { item } ) => textValue( item?.modified_at ) ),
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
		getValue: ( { item } ) => textValue( item?.modified_by ),
		sort: sortTextValues( ( { item } ) => textValue( item?.modified_by ) ),
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
		return null;
	}
	const number = Number( value );
	return Number.isFinite( number ) ? number : null;
}

function publicValue( value, type ) {
	switch ( type ) {
		case 'relation':
			return formatPublicRelation( value );
		case 'multiselect':
			return arrayValue( value );
		case 'number':
			return numberValue( value );
		case 'checkbox':
			return value === true;
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

function compareEmptyLast( a, b ) {
	const aEmpty = a === null || a === undefined || a === '';
	const bEmpty = b === null || b === undefined || b === '';
	if ( aEmpty && bEmpty ) {
		return 0;
	}
	if ( aEmpty ) {
		return 1;
	}
	if ( bEmpty ) {
		return -1;
	}
	return null;
}

function sortNumberValues( getValue ) {
	return ( a, b, direction ) => {
		const av = getValue( { item: a } );
		const bv = getValue( { item: b } );
		const emptyCompare = compareEmptyLast( av, bv );
		if ( emptyCompare !== null ) {
			return emptyCompare;
		}

		const an = Number( av );
		const bn = Number( bv );
		const diff =
			Number.isFinite( an ) && Number.isFinite( bn )
				? an - bn
				: String( av ).localeCompare( String( bv ) );
		return direction === 'asc' ? diff : -diff;
	};
}

function sortTextValues( getValue ) {
	return ( a, b, direction ) => {
		const av = getValue( { item: a } );
		const bv = getValue( { item: b } );
		const emptyCompare = compareEmptyLast( av, bv );
		if ( emptyCompare !== null ) {
			return emptyCompare;
		}

		const diff = textValue( av ).localeCompare( textValue( bv ) );
		return direction === 'asc' ? diff : -diff;
	};
}

function sortArrayValues( getValue ) {
	return ( a, b, direction ) => {
		const av = getValue( { item: a } );
		const bv = getValue( { item: b } );
		if ( av.length !== bv.length ) {
			const diff = av.length - bv.length;
			return direction === 'asc' ? diff : -diff;
		}

		const diff = av.join( ',' ).localeCompare( bv.join( ',' ) );
		return direction === 'asc' ? diff : -diff;
	};
}

function sortDateValues( getValue ) {
	return ( a, b, direction ) => {
		const av = getValue( { item: a } );
		const bv = getValue( { item: b } );
		const emptyCompare = compareEmptyLast( av, bv );
		if ( emptyCompare !== null ) {
			return emptyCompare;
		}

		const at = new Date( av ).getTime();
		const bt = new Date( bv ).getTime();
		const diff =
			Number.isFinite( at ) && Number.isFinite( bt )
				? at - bt
				: textValue( av ).localeCompare( textValue( bv ) );
		return direction === 'asc' ? diff : -diff;
	};
}

function sortBooleanValues( getValue ) {
	return ( a, b, direction ) => {
		const av = getValue( { item: a } );
		const bv = getValue( { item: b } );
		if ( av === bv ) {
			return 0;
		}
		const diff = av ? 1 : -1;
		return direction === 'asc' ? diff : -diff;
	};
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
			return {
				...base,
				type: 'integer',
				isValid: { custom: () => null },
				sort: sortNumberValues( base.getValue ),
			};
		case 'email':
			return {
				...base,
				type: 'email',
				sort: sortTextValues( base.getValue ),
			};
		case 'url':
			return {
				...base,
				type: 'text',
				sort: sortTextValues( base.getValue ),
			};
		case 'select':
			return {
				...base,
				type: 'text',
				elements,
				sort: sortTextValues( base.getValue ),
			};
		case 'multiselect':
			return {
				...base,
				type: 'array',
				elements,
				sort: sortArrayValues( base.getValue ),
			};
		case 'date':
		case 'datetime':
			return {
				...base,
				type: 'datetime',
				sort: sortDateValues( base.getValue ),
			};
		case 'checkbox':
			return {
				...base,
				type: 'boolean',
				sort: sortBooleanValues( base.getValue ),
			};
		case 'relation':
			return {
				...base,
				type: 'text',
				enableSorting: false,
				filterBy: false,
				sort: sortTextValues( base.getValue ),
			};
		case 'text':
		default:
			return {
				...base,
				type: 'text',
				sort: sortTextValues( base.getValue ),
			};
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
