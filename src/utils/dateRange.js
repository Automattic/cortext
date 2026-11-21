/**
 * Date and date-range values for date and datetime properties.
 *
 * A value is a single ISO date or datetime, or a start and an end joined by
 * a slash (`2026-03-01/2026-06-30`). The server stores and returns the
 * canonical form, so this only needs to split and join.
 *
 * Kept free of editor imports: the public bundle uses it too.
 */

const SEPARATOR = '/';
const ISO_START_PATTERN = /^\d{4}-\d{2}-\d{2}/;

// Returns `{ start, end }` with `end` null for a single date, or null when
// the value is empty or not a string.
export function parseDateRange( value ) {
	if ( typeof value !== 'string' || value === '' ) {
		return null;
	}
	const parts = value.split( SEPARATOR );
	if ( parts.length !== 2 || ! ISO_START_PATTERN.test( value ) ) {
		return { start: value, end: null };
	}
	return { start: parts[ 0 ], end: parts[ 1 ] || null };
}

export function joinDateRange( start, end ) {
	if ( ! start ) {
		return end || '';
	}
	return end && end !== start ? `${ start }${ SEPARATOR }${ end }` : start;
}

export function dateRangeStart( value ) {
	return parseDateRange( value )?.start ?? value;
}

export function dateRangeEnd( value ) {
	const parts = parseDateRange( value );
	return parts?.end ?? parts?.start ?? value;
}

// DataViews' date sort with ranges ordered by their start.
export function sortByDateRangeStart( a, b, direction ) {
	const timeA = new Date( dateRangeStart( a ) ).getTime();
	const timeB = new Date( dateRangeStart( b ) ).getTime();
	return direction === 'asc' ? timeA - timeB : timeB - timeA;
}
