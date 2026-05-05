import { __ } from '@wordpress/i18n';

import { formatDateValue, formatNumberValue } from './EditableCell';

export const CALCULATION_NONE = 'none';

export const CALCULATION_LABELS = {
	count: __( 'Count all', 'cortext' ),
	countValues: __( 'Count values', 'cortext' ),
	countUnique: __( 'Count unique values', 'cortext' ),
	empty: __( 'Count empty', 'cortext' ),
	notEmpty: __( 'Count not empty', 'cortext' ),
	percentEmpty: __( 'Percent empty', 'cortext' ),
	percentNotEmpty: __( 'Percent not empty', 'cortext' ),
	sum: __( 'Sum', 'cortext' ),
	average: __( 'Average', 'cortext' ),
	median: __( 'Median', 'cortext' ),
	min: __( 'Min', 'cortext' ),
	max: __( 'Max', 'cortext' ),
	range: __( 'Range', 'cortext' ),
};

export const CALCULATION_GROUP_LABELS = {
	count: __( 'Count', 'cortext' ),
	percent: __( 'Percent', 'cortext' ),
	math: __( 'Math', 'cortext' ),
};

const COUNT_CALCULATIONS = [
	'count',
	'countValues',
	'countUnique',
	'empty',
	'notEmpty',
];
const PRESENCE_COUNT_CALCULATIONS = [ 'count', 'empty', 'notEmpty' ];
const BOOLEAN_COUNT_CALCULATIONS = [ 'count' ];
const PERCENT_CALCULATIONS = [ 'percentEmpty', 'percentNotEmpty' ];
const NUMBER_CALCULATIONS = [
	'sum',
	'average',
	'median',
	'min',
	'max',
	'range',
];
const NUMBER_TYPES = new Set( [ 'number', 'integer' ] );
const DATE_TYPES = new Set( [ 'date', 'datetime' ] );
const BOOLEAN_TYPES = new Set( [ 'boolean', 'checkbox' ] );
const MULTI_VALUE_TYPES = new Set( [ 'array', 'multiselect' ] );
const SCALAR_COUNT_TYPES = new Set( [
	'title',
	'text',
	'email',
	'url',
	'select',
	'created-by',
	'modified-by',
	...NUMBER_TYPES,
	...DATE_TYPES,
] );

function fieldCalculationType( field ) {
	return field?.cortextType ?? field?.type ?? 'text';
}

function uniqueOptions( options ) {
	return options.filter(
		( option, index ) => options.indexOf( option ) === index
	);
}

export function isEmptyValue( value ) {
	return (
		value === null ||
		value === undefined ||
		value === '' ||
		( Array.isArray( value ) && value.length === 0 )
	);
}

export function calculationOptionsForField( field ) {
	return calculationGroupsForField( field ).flatMap(
		( group ) => group.options
	);
}

export function calculationGroupsForField( field ) {
	if ( ! field ) {
		return [];
	}
	const type = fieldCalculationType( field );
	let countOptions = PRESENCE_COUNT_CALCULATIONS;
	if ( BOOLEAN_TYPES.has( type ) ) {
		countOptions = BOOLEAN_COUNT_CALCULATIONS;
	} else if ( SCALAR_COUNT_TYPES.has( type ) ) {
		countOptions = COUNT_CALCULATIONS;
	} else if ( MULTI_VALUE_TYPES.has( type ) ) {
		countOptions = PRESENCE_COUNT_CALCULATIONS;
	}

	const groups = [];
	if ( countOptions.length > 0 ) {
		groups.push( {
			id: 'count',
			label: CALCULATION_GROUP_LABELS.count,
			options: countOptions,
		} );
	}
	if (
		countOptions.includes( 'empty' ) &&
		countOptions.includes( 'notEmpty' )
	) {
		groups.push( {
			id: 'percent',
			label: CALCULATION_GROUP_LABELS.percent,
			options: PERCENT_CALCULATIONS,
		} );
	}
	const moreOptions = [];
	if ( NUMBER_TYPES.has( type ) ) {
		moreOptions.push( ...NUMBER_CALCULATIONS );
	} else if ( DATE_TYPES.has( type ) ) {
		moreOptions.push( 'min', 'max' );
	}

	if ( moreOptions.length > 0 ) {
		groups.push( {
			id: 'math',
			label: CALCULATION_GROUP_LABELS.math,
			options: uniqueOptions( moreOptions ),
		} );
	}

	return groups;
}

export function isCalculationAvailable( field, calculation ) {
	return calculationOptionsForField( field ).includes( calculation );
}

export function sanitizeCalculations( calculations, fields = [] ) {
	if (
		! calculations ||
		typeof calculations !== 'object' ||
		Array.isArray( calculations )
	) {
		return {};
	}

	const fieldsById = new Map(
		fields.map( ( field ) => [ field.id, field ] )
	);
	const next = {};
	for ( const [ fieldId, calculation ] of Object.entries( calculations ) ) {
		const field = fieldsById.get( fieldId );
		if ( field && isCalculationAvailable( field, calculation ) ) {
			next[ fieldId ] = calculation;
		}
	}
	return next;
}

export function withColumnCalculation( view, fieldId, calculation ) {
	const current = view?.calculations ?? {};
	const next = { ...current };
	if ( calculation ) {
		next[ fieldId ] = calculation;
	} else {
		delete next[ fieldId ];
	}

	const nextView = { ...view };
	if ( Object.keys( next ).length > 0 ) {
		nextView.calculations = next;
	} else {
		delete nextView.calculations;
	}
	return nextView;
}

function valuesForField( rows, field ) {
	return rows.map( ( item ) => field.getValue( { item } ) );
}

function numericValues( values ) {
	return values
		.filter( ( value ) => ! isEmptyValue( value ) )
		.map( ( value ) =>
			typeof value === 'number' ? value : Number( value )
		)
		.filter( ( value ) => Number.isFinite( value ) );
}

function medianValue( numbers ) {
	if ( numbers.length === 0 ) {
		return null;
	}
	const sorted = [ ...numbers ].sort( ( a, b ) => a - b );
	const middle = Math.floor( sorted.length / 2 );
	if ( sorted.length % 2 === 1 ) {
		return sorted[ middle ];
	}
	return ( sorted[ middle - 1 ] + sorted[ middle ] ) / 2;
}

function populatedValues( values ) {
	return values.filter( ( value ) => ! isEmptyValue( value ) );
}

function uniqueKey( value ) {
	if ( Array.isArray( value ) ) {
		return JSON.stringify( value.map( String ).sort() );
	}
	return String( value );
}

function formatPercent( part, total ) {
	if ( total === 0 ) {
		return '';
	}
	return new Intl.NumberFormat( undefined, {
		style: 'percent',
		maximumFractionDigits: 0,
	} ).format( part / total );
}

function comparableValue( value, field ) {
	if ( isEmptyValue( value ) ) {
		return null;
	}

	const type = fieldCalculationType( field );
	if ( NUMBER_TYPES.has( type ) ) {
		const number = typeof value === 'number' ? value : Number( value );
		return Number.isFinite( number ) ? number : null;
	}

	if ( DATE_TYPES.has( type ) ) {
		const timestamp = new Date( value ).getTime();
		return Number.isFinite( timestamp ) ? timestamp : null;
	}

	return null;
}

function compareComparable( a, b ) {
	if ( typeof a === 'string' || typeof b === 'string' ) {
		return String( a ).localeCompare( String( b ) );
	}
	return a - b;
}

function extremaValue( values, field, direction ) {
	let best = null;
	for ( const value of values ) {
		const comparable = comparableValue( value, field );
		if ( comparable === null ) {
			continue;
		}
		if (
			best === null ||
			( direction === 'min' &&
				compareComparable( comparable, best.comparable ) < 0 ) ||
			( direction === 'max' &&
				compareComparable( comparable, best.comparable ) > 0 )
		) {
			best = { comparable, value };
		}
	}
	return best?.value;
}

function formatSelectValue( value, field ) {
	const element = field.elements?.find( ( item ) => item.value === value );
	return element?.label ?? String( value );
}

function formatResultValue( value, field ) {
	if ( isEmptyValue( value ) ) {
		return '';
	}

	const type = fieldCalculationType( field );
	if ( NUMBER_TYPES.has( type ) ) {
		return formatNumberValue( value, field.cortextFormat );
	}

	if ( DATE_TYPES.has( type ) ) {
		return formatDateValue( value, type, field.cortextFormat );
	}

	if ( field.elements ) {
		return formatSelectValue( value, field );
	}

	return String( value );
}

export function calculateField( rows, field, calculation ) {
	if ( ! isCalculationAvailable( field, calculation ) ) {
		return '';
	}

	if ( calculation === 'count' ) {
		return String( rows.length );
	}

	const values = valuesForField( rows, field );
	switch ( calculation ) {
		case 'countValues':
			return String( populatedValues( values ).length );
		case 'countUnique':
			return String(
				new Set( populatedValues( values ).map( uniqueKey ) ).size
			);
		case 'empty':
			return String( values.filter( isEmptyValue ).length );
		case 'notEmpty':
			return String(
				values.filter( ( value ) => ! isEmptyValue( value ) ).length
			);
		case 'percentEmpty':
			return formatPercent(
				values.filter( isEmptyValue ).length,
				rows.length
			);
		case 'percentNotEmpty':
			return formatPercent(
				populatedValues( values ).length,
				rows.length
			);
		case 'sum': {
			const numbers = numericValues( values );
			return numbers.length
				? formatResultValue(
						numbers.reduce( ( total, value ) => total + value, 0 ),
						field
				  )
				: '';
		}
		case 'average': {
			const numbers = numericValues( values );
			return numbers.length
				? formatResultValue(
						numbers.reduce( ( total, value ) => total + value, 0 ) /
							numbers.length,
						field
				  )
				: '';
		}
		case 'median': {
			const numbers = numericValues( values );
			return numbers.length
				? formatResultValue( medianValue( numbers ), field )
				: '';
		}
		case 'range': {
			const numbers = numericValues( values );
			return numbers.length
				? formatResultValue(
						Math.max( ...numbers ) - Math.min( ...numbers ),
						field
				  )
				: '';
		}
		case 'min':
		case 'max':
			return formatResultValue(
				extremaValue( values, field, calculation ),
				field
			);
		default:
			return '';
	}
}
