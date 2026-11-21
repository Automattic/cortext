import { getDate } from '@wordpress/date';
import { filterSortAndPaginate } from '@wordpress/dataviews/wp';

import { parseDateRange } from '../utils/dateRange';

const MANUAL_SORT_ID = 'manual';
const DATE_FIELD_TYPES = new Set( [ 'date', 'datetime' ] );
const OVERLAP_OPERATORS = new Set( [ 'between', 'on' ] );

function isGroupFilter( filter ) {
	return Boolean( filter?.relation || filter?.filters );
}

function hasGroupFilters( filters ) {
	return Array.isArray( filters ) && filters.some( isGroupFilter );
}

function valuesIntersect( fieldValue, filterValues ) {
	if ( Array.isArray( fieldValue ) ) {
		return filterValues.some( ( value ) => fieldValue.includes( value ) );
	}
	return filterValues.includes( fieldValue );
}

function normalizeText( value ) {
	return String( value ).toLowerCase();
}

function isEmptyValue( value ) {
	return (
		value === undefined ||
		value === null ||
		value === '' ||
		( Array.isArray( value ) && value.length === 0 )
	);
}

function dateOrNull( value ) {
	const date = getDate( value );
	return Number.isNaN( date.getTime() ) ? null : date;
}

// Date and datetime values can be a `start/end` range, which DataViews'
// own operators can't read. `between` and `on` match any overlap with the
// requested days, like the server does.
function isDateOverlapFilter( filter, fieldMap ) {
	return (
		! isGroupFilter( filter ) &&
		OVERLAP_OPERATORS.has( filter?.operator ) &&
		DATE_FIELD_TYPES.has( fieldMap.get( filter?.field )?.type )
	);
}

function matchesDateOverlap( fieldValue, operator, filterValue ) {
	const bounds =
		operator === 'on' ? [ filterValue, filterValue ] : filterValue;
	if (
		! Array.isArray( bounds ) ||
		bounds.length !== 2 ||
		bounds.some( ( bound ) => bound === undefined || bound === '' )
	) {
		return true;
	}
	const range = parseDateRange( fieldValue );
	const start = range && dateOrNull( range.start );
	const end = range && dateOrNull( range.end ?? range.start );
	const from = dateOrNull( bounds[ 0 ] );
	const to = dateOrNull( bounds[ 1 ] );
	if ( ! start || ! end || ! from || ! to ) {
		return false;
	}
	const [ low, high ] = from <= to ? [ from, to ] : [ to, from ];
	return start <= high && end >= low;
}

function relativeDate( value, unit ) {
	const date = new Date();
	const amount = Number( value );
	if ( ! Number.isFinite( amount ) ) {
		return date;
	}

	switch ( unit ) {
		case 'days':
			date.setDate( date.getDate() - amount );
			return date;
		case 'weeks':
			date.setDate( date.getDate() - amount * 7 );
			return date;
		case 'months':
			date.setMonth( date.getMonth() - amount );
			return date;
		case 'years':
			date.setFullYear( date.getFullYear() - amount );
			return date;
		default:
			return date;
	}
}

function matchesLeaf( item, filter, fieldMap ) {
	const field = filter?.field ? fieldMap.get( filter.field ) : null;
	if ( ! field ) {
		return true;
	}

	const fieldValue = field.getValue( { item } );
	const filterValue = filter.value;
	const filterValues = Array.isArray( filterValue ) ? filterValue : [];

	if ( isDateOverlapFilter( filter, fieldMap ) ) {
		return matchesDateOverlap( fieldValue, filter.operator, filterValue );
	}

	switch ( filter.operator ) {
		case 'isAny':
			return filterValues.length > 0
				? valuesIntersect( fieldValue, filterValues )
				: true;
		case 'isNone':
			return filterValues.length > 0
				? ! valuesIntersect( fieldValue, filterValues )
				: true;
		case 'isAll':
			return filterValues.length > 0 && Array.isArray( fieldValue )
				? filterValues.every( ( value ) =>
						fieldValue.includes( value )
				  )
				: true;
		case 'isNotAll':
			return filterValues.length > 0 && Array.isArray( fieldValue )
				? filterValues.every(
						( value ) => ! fieldValue.includes( value )
				  )
				: true;
		case 'is':
			return filterValue === undefined || filterValue === fieldValue;
		case 'isNot':
			return filterValue !== fieldValue;
		case 'contains': {
			if ( filterValue === undefined || ! filterValue ) {
				return true;
			}
			if ( Array.isArray( fieldValue ) ) {
				return fieldValue.includes( filterValue );
			}
			return (
				typeof fieldValue === 'string' &&
				normalizeText( fieldValue ).includes(
					normalizeText( filterValue )
				)
			);
		}
		case 'notContains': {
			if ( filterValue === undefined || ! filterValue ) {
				return true;
			}
			if ( Array.isArray( fieldValue ) ) {
				return ! fieldValue.includes( filterValue );
			}
			return (
				typeof fieldValue === 'string' &&
				! normalizeText( fieldValue ).includes(
					normalizeText( filterValue )
				)
			);
		}
		case 'startsWith':
			return filterValue === undefined || ! filterValue
				? true
				: typeof fieldValue === 'string' &&
						normalizeText( fieldValue ).startsWith(
							normalizeText( filterValue )
						);
		case 'endsWith':
			return filterValue === undefined || ! filterValue
				? true
				: typeof fieldValue === 'string' &&
						normalizeText( fieldValue ).endsWith(
							normalizeText( filterValue )
						);
		case 'lessThan':
			return filterValue === undefined ? true : fieldValue < filterValue;
		case 'greaterThan':
			return filterValue === undefined ? true : fieldValue > filterValue;
		case 'lessThanOrEqual':
			return filterValue === undefined ? true : fieldValue <= filterValue;
		case 'greaterThanOrEqual':
			return filterValue === undefined ? true : fieldValue >= filterValue;
		case 'between':
			return (
				Array.isArray( filterValue ) &&
				filterValue.length === 2 &&
				filterValue[ 0 ] !== undefined &&
				filterValue[ 1 ] !== undefined &&
				fieldValue >= filterValue[ 0 ] &&
				fieldValue <= filterValue[ 1 ]
			);
		case 'on': {
			if ( filterValue === undefined ) {
				return true;
			}
			const fieldDate = dateOrNull( fieldValue );
			const filterDate = dateOrNull( filterValue );
			return Boolean(
				fieldDate &&
					filterDate &&
					fieldDate.getTime() === filterDate.getTime()
			);
		}
		case 'notOn': {
			if ( filterValue === undefined ) {
				return true;
			}
			const fieldDate = dateOrNull( fieldValue );
			const filterDate = dateOrNull( filterValue );
			return Boolean(
				fieldDate &&
					filterDate &&
					fieldDate.getTime() !== filterDate.getTime()
			);
		}
		case 'before':
		case 'after':
		case 'beforeInc':
		case 'afterInc': {
			if ( filterValue === undefined ) {
				return true;
			}
			const fieldDate = dateOrNull( fieldValue );
			const filterDate = dateOrNull( filterValue );
			if ( ! fieldDate || ! filterDate ) {
				return false;
			}
			if ( filter.operator === 'before' ) {
				return fieldDate < filterDate;
			}
			if ( filter.operator === 'after' ) {
				return fieldDate > filterDate;
			}
			if ( filter.operator === 'beforeInc' ) {
				return fieldDate <= filterDate;
			}
			return fieldDate >= filterDate;
		}
		case 'inThePast':
		case 'over': {
			if (
				filterValue?.value === undefined ||
				filterValue?.unit === undefined
			) {
				return true;
			}
			const fieldDate = dateOrNull( fieldValue );
			if ( ! fieldDate ) {
				return false;
			}
			const targetDate = relativeDate(
				filterValue.value,
				filterValue.unit
			);
			return filter.operator === 'inThePast'
				? fieldDate >= targetDate && fieldDate <= new Date()
				: fieldDate < targetDate;
		}
		case 'isEmpty':
			return isEmptyValue( fieldValue );
		case 'isNotEmpty':
			return ! isEmptyValue( fieldValue );
		case 'isChecked':
			return (
				fieldValue === true || fieldValue === 1 || fieldValue === '1'
			);
		case 'isUnchecked':
			return (
				fieldValue === false ||
				fieldValue === 0 ||
				fieldValue === '0' ||
				isEmptyValue( fieldValue )
			);
		default:
			return true;
	}
}

function matchesFilterNode( item, filter, fieldMap ) {
	if ( ! filter || typeof filter !== 'object' ) {
		return true;
	}

	if ( ! isGroupFilter( filter ) ) {
		return matchesLeaf( item, filter, fieldMap );
	}

	const children = Array.isArray( filter.filters ) ? filter.filters : [];
	if ( children.length === 0 ) {
		return true;
	}

	const relation = String( filter.relation ?? 'AND' ).toUpperCase();
	return relation === 'OR'
		? children.some( ( child ) =>
				matchesFilterNode( item, child, fieldMap )
		  )
		: children.every( ( child ) =>
				matchesFilterNode( item, child, fieldMap )
		  );
}

function matchesFilters( item, filters, fieldMap ) {
	if ( ! Array.isArray( filters ) || filters.length === 0 ) {
		return true;
	}
	return filters.every( ( filter ) =>
		matchesFilterNode( item, filter, fieldMap )
	);
}

export function filterSortAndPaginateWithGroups( data, view, fields ) {
	const queryView =
		view?.sort?.field === MANUAL_SORT_ID
			? { ...( view ?? {} ), sort: null }
			: view;

	const fieldMap = new Map( fields.map( ( field ) => [ field.id, field ] ) );
	const filters = Array.isArray( view?.filters ) ? view.filters : [];
	// Group filters take every filter; otherwise only date overlaps are
	// matched here and the rest stay with DataViews.
	const ownFilters = hasGroupFilters( filters )
		? filters
		: filters.filter( ( filter ) =>
				isDateOverlapFilter( filter, fieldMap )
		  );

	if ( ownFilters.length === 0 ) {
		return filterSortAndPaginate( data, queryView, fields );
	}

	const filteredData = ( Array.isArray( data ) ? data : [] ).filter(
		( item ) => matchesFilters( item, ownFilters, fieldMap )
	);

	return filterSortAndPaginate(
		filteredData,
		{
			...( queryView ?? {} ),
			filters: filters.filter(
				( filter ) => ! ownFilters.includes( filter )
			),
		},
		fields
	);
}
