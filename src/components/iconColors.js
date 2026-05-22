import { __ } from '@wordpress/i18n';

// Named icon colors persisted in the `cortext_document_icon` meta as the
// `color` field. PHP sanitization accepts only these names, so the JS palette
// is the source of truth for both the picker UI and the renderer.
export const ICON_COLORS = [
	{ name: 'gray', label: __( 'Gray', 'cortext' ), css: '#9ca3af' },
	{ name: 'brown', label: __( 'Brown', 'cortext' ), css: '#92400e' },
	{ name: 'orange', label: __( 'Orange', 'cortext' ), css: '#f97316' },
	{ name: 'yellow', label: __( 'Yellow', 'cortext' ), css: '#eab308' },
	{ name: 'green', label: __( 'Green', 'cortext' ), css: '#22c55e' },
	{ name: 'blue', label: __( 'Blue', 'cortext' ), css: '#3b82f6' },
	{ name: 'purple', label: __( 'Purple', 'cortext' ), css: '#a855f7' },
	{ name: 'pink', label: __( 'Pink', 'cortext' ), css: '#ec4899' },
	{ name: 'red', label: __( 'Red', 'cortext' ), css: '#ef4444' },
];

// Lookup map for the renderer: name → css value. Unknown names yield
// undefined so callers can fall back to the surrounding color.
export const ICON_COLOR_BY_NAME = Object.fromEntries(
	ICON_COLORS.map( ( c ) => [ c.name, c.css ] )
);
