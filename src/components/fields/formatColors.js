import { __ } from '@wordpress/i18n';

// Bar/ring color palette. `hex: null` for "Default" lets the cell
// renderer fall through to the WordPress admin theme color, so the
// out-of-the-box visual matches whatever accent the site uses.
export const FORMAT_COLORS = [
	{ id: 'default', label: __( 'Default', 'cortext' ), hex: null },
	{ id: 'gray', label: __( 'Gray', 'cortext' ), hex: '#9b9b9b' },
	{ id: 'brown', label: __( 'Brown', 'cortext' ), hex: '#8b6f47' },
	{ id: 'orange', label: __( 'Orange', 'cortext' ), hex: '#d9730d' },
	{ id: 'yellow', label: __( 'Yellow', 'cortext' ), hex: '#dfab01' },
	{ id: 'green', label: __( 'Green', 'cortext' ), hex: '#0f7b6c' },
	{ id: 'blue', label: __( 'Blue', 'cortext' ), hex: '#0b6e99' },
	{ id: 'purple', label: __( 'Purple', 'cortext' ), hex: '#6940a5' },
	{ id: 'pink', label: __( 'Pink', 'cortext' ), hex: '#ad1a72' },
	{ id: 'red', label: __( 'Red', 'cortext' ), hex: '#e03e3e' },
];

export function findFormatColor( id ) {
	return FORMAT_COLORS.find( ( c ) => c.id === id ) ?? FORMAT_COLORS[ 0 ];
}

export function resolveFormatColor( id ) {
	return findFormatColor( id ).hex;
}
