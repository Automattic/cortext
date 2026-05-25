import { __ } from '@wordpress/i18n';
import { dateI18n } from '@wordpress/date';
import {
	BaseControl,
	Flex,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalNumberControl as NumberControl,
} from '@wordpress/components';

import EditableCell from '../components/EditableCell';
import { SystemFieldIcon } from '../components/fields/fieldTypes';
import { elementsFromOptions } from './optionElements';

// Re-export for existing call sites. The implementation lives in
// `optionElements` (a leaf module with no React/component imports) so
// it can be pulled into both UI code and Jest unit tests of
// `useFieldMutations` without dragging `@wordpress/components` along.
export { elementsFromOptions };

// Parses stored format meta (number_format / date_format) into a plain
// object. Same forgiving contract as `elementsFromOptions`: malformed
// JSON, non-objects, and empty values all return `undefined` so callers
// fall through to type-level defaults.
export function parseFormat( raw ) {
	if ( ! raw ) {
		return undefined;
	}
	let parsed;
	try {
		parsed = typeof raw === 'string' ? JSON.parse( raw ) : raw;
	} catch {
		return undefined;
	}
	if ( ! parsed || typeof parsed !== 'object' || Array.isArray( parsed ) ) {
		return undefined;
	}
	return parsed;
}

// Cortext field types that this client knows how to edit inline. Anything
// outside this set (formula, rollup, …) renders read-only — see
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
	'relation',
] );

const SEARCHABLE_TYPES = new Set( [ 'text', 'email', 'url' ] );
const DATAVIEWS_TEXT_FILTER_OPERATORS = [
	'is',
	'isNot',
	'contains',
	'notContains',
	'startsWith',
];
const DATAVIEWS_NUMBER_FILTER_OPERATORS = [
	'is',
	'greaterThan',
	'lessThan',
	'between',
];
const DATAVIEWS_DATE_FILTER_OPERATORS = [ 'on', 'before', 'after', 'between' ];
const DATAVIEWS_DATETIME_FILTER_OPERATORS = [ 'on', 'before', 'after' ];
const DATAVIEWS_OPTION_FILTER_OPERATORS = [ 'isAny', 'isNone' ];
const SERVER_SORT_ONLY = {
	sortable: true,
	filterable: false,
	operators: [],
};
const NOT_SERVER_QUERYABLE = {
	sortable: false,
	filterable: false,
	operators: [],
};
const ROLLUP_VALUE_AGGREGATORS = new Set( [ 'show_original', 'show_unique' ] );
const ROLLUP_NUMERIC_AGGREGATORS = new Set( [
	'count',
	'count_values',
	'count_unique',
	'empty',
	'not_empty',
	'percent_empty',
	'percent_not_empty',
	'sum',
	'avg',
	'median',
	'min',
	'max',
	'range',
] );
const ROLLUP_SCALAR_DATE_AGGREGATORS = new Set( [ 'earliest', 'latest' ] );

function parseBooleanMeta( raw, fallback = false ) {
	if ( raw === undefined || raw === null || raw === '' ) {
		return fallback;
	}
	if ( typeof raw === 'boolean' ) {
		return raw;
	}
	return [ '1', 'true', 'yes', 'on' ].includes(
		String( raw ).trim().toLowerCase()
	);
}

function rollupDisplayType( meta ) {
	const aggregator = meta?.rollup_aggregator ?? 'count';
	if ( aggregator === 'date_range' ) {
		return 'rollup-date-range';
	}
	if ( ROLLUP_VALUE_AGGREGATORS.has( aggregator ) ) {
		const targetType = meta?.rollup_target_type ?? 'text';
		return targetType === 'select' ? 'multiselect' : targetType;
	}
	if ( ! ROLLUP_SCALAR_DATE_AGGREGATORS.has( aggregator ) ) {
		return 'number';
	}
	// Preserve the target field's date/datetime distinction so
	// `formatDateValue` can take its timezone-safe `date` path on
	// `YYYY-MM-DD` values. Defaults to `date` when unknown — that's the
	// branch that won't shift west of UTC.
	return meta?.rollup_target_type === 'datetime' ? 'datetime' : 'date';
}

function buildRender( id, type, label, elements, format, relation ) {
	const readOnly = ! EDITABLE_TYPES.has( type );
	const displayType = type === 'rollup' ? rollupDisplayType( format ) : type;
	return ( { item } ) => (
		<EditableCell
			item={ item }
			fieldId={ id }
			fieldType={ displayType }
			elements={ elements }
			format={ format }
			relation={ relation }
			label={ label }
			readOnly={ readOnly }
		/>
	);
}

function HeaderLabel( { children } ) {
	return <span className="cortext-column-header-label">{ children }</span>;
}

function SystemHeaderLabel( { fieldId, children } ) {
	return (
		<span className="cortext-column-header-content">
			<SystemFieldIcon
				fieldId={ fieldId }
				className="cortext-column-header-type-icon cortext-column-header-system-icon"
			/>
			<span className="cortext-column-header-label">{ children }</span>
		</span>
	);
}

function rollupTargetFormat( meta ) {
	if ( meta?.rollup_target_type === 'number' ) {
		return parseFormat( meta?.rollup_target_number_format );
	}
	if (
		meta?.rollup_target_type === 'date' ||
		meta?.rollup_target_type === 'datetime'
	) {
		return parseFormat( meta?.rollup_target_date_format );
	}
	return undefined;
}

function fieldRelationConfig( field, type, rollupTargetType ) {
	if ( type === 'relation' ) {
		return {
			targetCollectionId: Number( field.meta?.related_collection_id ),
			multiple: parseBooleanMeta( field.meta?.relation_multiple, true ),
		};
	}
	if ( type === 'rollup' && rollupTargetType === 'relation' ) {
		return {
			targetCollectionId: Number(
				field.meta?.rollup_target_related_collection_id
			),
			multiple: parseBooleanMeta(
				field.meta?.rollup_target_relation_multiple,
				true
			),
		};
	}
	return undefined;
}

function isEmptySortValue( value ) {
	return value === null || value === undefined || value === '';
}

function compareEmptyLast( aValue, bValue ) {
	const aEmpty = isEmptySortValue( aValue );
	const bEmpty = isEmptySortValue( bValue );
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

function numberFilterValue( value ) {
	return value === '' || value === undefined ? undefined : Number( value );
}

function NumberFilterControl( {
	data,
	field,
	onChange,
	hideLabelFromVision,
	operator,
} ) {
	const { id, label, description } = field;
	const value = field.getValue( { item: data } ) ?? '';

	if ( operator === 'between' ) {
		const [ min = '', max = '' ] = Array.isArray( value ) ? value : [];
		return (
			<BaseControl __nextHasNoMarginBottom>
				<Flex direction="row" gap={ 4 }>
					<NumberControl
						label={ __( 'Min.', 'cortext' ) }
						value={ min }
						onChange={ ( next ) =>
							onChange( {
								[ id ]: [ numberFilterValue( next ), max ],
							} )
						}
						__next40pxDefaultSize
						hideLabelFromVision={ hideLabelFromVision }
					/>
					<NumberControl
						label={ __( 'Max.', 'cortext' ) }
						value={ max }
						onChange={ ( next ) =>
							onChange( {
								[ id ]: [ min, numberFilterValue( next ) ],
							} )
						}
						__next40pxDefaultSize
						hideLabelFromVision={ hideLabelFromVision }
					/>
				</Flex>
			</BaseControl>
		);
	}

	return (
		<NumberControl
			label={ label }
			help={ description }
			value={ value }
			onChange={ ( next ) =>
				onChange( { [ id ]: numberFilterValue( next ) } )
			}
			__next40pxDefaultSize
			hideLabelFromVision={ hideLabelFromVision }
		/>
	);
}

function supportedDataViewsOperators( operators, candidates ) {
	return candidates.filter( ( operator ) => operators.includes( operator ) );
}

export function dataViewsFilterByForType( type, operators ) {
	let supported = [];
	switch ( type ) {
		case 'text':
		case 'email':
		case 'url':
			supported = supportedDataViewsOperators(
				operators,
				DATAVIEWS_TEXT_FILTER_OPERATORS
			);
			break;
		case 'number':
			supported = supportedDataViewsOperators(
				operators,
				DATAVIEWS_NUMBER_FILTER_OPERATORS
			);
			break;
		case 'date':
			supported = supportedDataViewsOperators(
				operators,
				DATAVIEWS_DATE_FILTER_OPERATORS
			);
			break;
		case 'datetime':
			supported = supportedDataViewsOperators(
				operators,
				DATAVIEWS_DATETIME_FILTER_OPERATORS
			);
			break;
		case 'select':
		case 'multiselect':
			supported = supportedDataViewsOperators(
				operators,
				DATAVIEWS_OPTION_FILTER_OPERATORS
			);
			break;
		default:
			return undefined;
	}
	return supported.length > 0 ? { operators: supported } : undefined;
}

function fieldValue( item, id ) {
	if ( item && Object.prototype.hasOwnProperty.call( item, id ) ) {
		return item[ id ];
	}
	return item?.meta?.[ id ] ?? null;
}

function checkboxFieldValue( item, id ) {
	return parseBooleanMeta( fieldValue( item, id ), false );
}

// Returns the four read-only system fields surfaced alongside each
// collection's custom fields: created at, last edited at, created by,
// last edited by. The values come straight off the row payload (the
// REST controller injects them in `format_row`); these definitions just
// describe how they're rendered and which ones are sortable.
//
// `editable: false` and no `recordId` keeps them out of the default
// `view.fields` seed, so they appear in the column visibility menu
// default-hidden, addable like any other field. Sort is enabled only on
// the timestamps — sort on display-value
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
			header: (
				<SystemHeaderLabel fieldId="created_at">
					{ __( 'Created', 'cortext' ) }
				</SystemHeaderLabel>
			),
			type: 'datetime',
			cortextType: 'datetime',
			...SERVER_SORT_ONLY,
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
			header: (
				<SystemHeaderLabel fieldId="created_by">
					{ __( 'Created by', 'cortext' ) }
				</SystemHeaderLabel>
			),
			type: 'text',
			cortextType: 'text',
			...NOT_SERVER_QUERYABLE,
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
			header: (
				<SystemHeaderLabel fieldId="modified_at">
					{ __( 'Last edited', 'cortext' ) }
				</SystemHeaderLabel>
			),
			type: 'datetime',
			cortextType: 'datetime',
			...SERVER_SORT_ONLY,
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
			header: (
				<SystemHeaderLabel fieldId="modified_by">
					{ __( 'Last edited by', 'cortext' ) }
				</SystemHeaderLabel>
			),
			type: 'text',
			cortextType: 'text',
			...NOT_SERVER_QUERYABLE,
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
	const rollupTargetType = field.meta?.rollup_target_type;
	const elements = elementsFromOptions(
		type === 'rollup'
			? field.meta?.rollup_target_options
			: field.meta?.options
	);
	let format;
	if ( type === 'number' ) {
		format = parseFormat( field.meta?.number_format );
	} else if ( type === 'date' || type === 'datetime' ) {
		format = parseFormat( field.meta?.date_format );
	} else if ( type === 'rollup' ) {
		const aggregator = field.meta?.rollup_aggregator ?? 'count';
		format = {
			...( rollupTargetFormat( field.meta ) ?? {} ),
			rollup_aggregator: aggregator,
			rollup_target_type: rollupTargetType,
		};
		if (
			aggregator === 'percent_empty' ||
			aggregator === 'percent_not_empty'
		) {
			format.style = 'percent';
			format.decimals = format.decimals ?? 0;
		}
	}
	const relation = fieldRelationConfig( field, type, rollupTargetType );
	const capabilities = field.cortext_capabilities ?? {};
	const operators = Array.isArray( capabilities.operators )
		? capabilities.operators
		: [];
	const base = {
		id,
		label,
		recordId: field.id,
		cortextType: type,
		sortable: capabilities.sortable === true,
		filterable: capabilities.filterable === true,
		operators,
		filterBy: dataViewsFilterByForType( type, operators ),
		relatedCollectionId: relation?.targetCollectionId,
		relationMultiple: relation?.multiple,
		rollupAggregator: field.meta?.rollup_aggregator,
		rollupRelationFieldId: Number( field.meta?.rollup_relation_field_id ),
		rollupTargetFieldId: Number( field.meta?.rollup_target_field_id ),
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
		getValue: ( { item } ) => fieldValue( item, id ),
		render: buildRender( id, type, label, elements, format, relation ),
		editable: EDITABLE_TYPES.has( type ),
		enableGlobalSearch: SEARCHABLE_TYPES.has( type ),
		cortextFieldType: type,
		cortextElements: elements,
		cortextFormat: format,
		cortextRecordId: field.id,
	};

	// DataViews v6's FieldType union is
	// `'text' | 'integer' | 'datetime' | 'date' | 'media' | 'boolean' | 'email' | 'array'`.
	// EditableCell drives the actual edit/display, so these mappings only
	// affect column-level metadata (default sort comparator, future filter
	// UI). We pick the closest honest type rather than the prettiest one:
	// decimals go through 'integer' with DataViews' integer-only
	// validator disabled because there's no exact number type
	// (tech-debt.md#10), url goes through 'text', and multiselect goes
	// through 'array' so DataViews understands the value cardinality.
	switch ( type ) {
		case 'number':
			return {
				...base,
				type: 'integer',
				Edit: NumberFilterControl,
				isValid: { custom: () => null },
				sort: sortNumberValues( base.getValue ),
			};
		case 'email':
			return { ...base, type: 'email' };
		case 'url':
			return { ...base, type: 'text' };
		case 'select':
			return { ...base, type: 'text', elements };
		case 'multiselect':
			return { ...base, type: 'array', elements };
		case 'checkbox':
			return {
				...base,
				type: 'boolean',
				getValue: ( { item } ) => checkboxFieldValue( item, id ),
			};
		case 'relation':
			return {
				...base,
				type: 'array',
				enableSorting: false,
				filterBy: false,
			};
		case 'rollup': {
			const aggregator = field.meta?.rollup_aggregator ?? 'count';
			const display = rollupDisplayType( field.meta );
			if ( ROLLUP_SCALAR_DATE_AGGREGATORS.has( aggregator ) ) {
				return {
					...base,
					type: display,
					editable: false,
					enableSorting: true,
				};
			}
			if ( ROLLUP_NUMERIC_AGGREGATORS.has( aggregator ) ) {
				return {
					...base,
					type: 'integer',
					editable: false,
					enableSorting: true,
					isValid: { custom: () => null },
					sort: ( a, b, direction ) => {
						const av = Number( base.getValue( { item: a } ) ?? 0 );
						const bv = Number( base.getValue( { item: b } ) ?? 0 );
						return direction === 'asc' ? av - bv : bv - av;
					},
				};
			}
			return {
				...base,
				type:
					display === 'relation' || display === 'multiselect'
						? 'array'
						: 'text',
				editable: false,
				enableSorting: false,
				filterBy: false,
			};
		}
		case 'date':
			return { ...base, type: 'date' };
		case 'datetime':
			return { ...base, type: 'datetime' };
		case 'text':
		default:
			return { ...base, type: 'text' };
	}
}
