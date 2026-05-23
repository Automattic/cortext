import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/components';
import {
	atSymbol,
	backup,
	calendar,
	check,
	formatListBullets,
	globe,
	link,
	tag,
	typography,
} from '@wordpress/icons';

import './fieldTypes.scss';

// Inline SVG for the "number" type. `@wordpress/icons` doesn't ship a
// numeric glyph that reads as "single number" (formatListNumbered looks
// like an ordered list), so we draw a `#` at the same stroke weight.
const numberIcon = (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		width="24"
		height="24"
	>
		<path
			d="M9.5 5l-1 5H5v1.5h3.2l-.7 3.5H4v1.5h3.2L6.5 19h1.5l.7-3.5h3.5L11.5 19h1.5l.7-3.5h3v-1.5h-2.7l.7-3.5H17V9h-3.2l.7-4h-1.5l-.7 4h-3.5l.7-4h-1.5z"
			fill="currentColor"
		/>
	</svg>
);

// Inline SVG for "date and time": a calendar with a clock face. Mirrors
// Keep Date and Date & time as separate field choices.
const datetimeIcon = (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		width="24"
		height="24"
	>
		<path
			d="M19 4h-2V3a1 1 0 1 0-2 0v1H9V3a1 1 0 1 0-2 0v1H5a2 2 0 0 0-2 2v13a2 2 0 0 0 2 2h7.1a5.5 5.5 0 1 1 8.4-7H21V6a2 2 0 0 0-2-2zm0 6H5V6h2v1a1 1 0 1 0 2 0V6h6v1a1 1 0 1 0 2 0V6h2v4zm-2 4v3h-3v1.5h4.5V14H17z"
			fill="currentColor"
		/>
		<circle
			cx="17"
			cy="17"
			r="4.5"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.5"
		/>
	</svg>
);

export const FIELD_TYPES = [
	{ value: 'text', label: __( 'Text', 'cortext' ), icon: typography },
	{ value: 'number', label: __( 'Number', 'cortext' ), icon: numberIcon },
	{
		value: 'select',
		label: __( 'Select', 'cortext' ),
		icon: formatListBullets,
	},
	{
		value: 'multiselect',
		label: __( 'Multi-select', 'cortext' ),
		icon: tag,
	},
	{ value: 'date', label: __( 'Date', 'cortext' ), icon: calendar },
	{
		value: 'datetime',
		label: __( 'Date & time', 'cortext' ),
		icon: datetimeIcon,
	},
	{ value: 'checkbox', label: __( 'Checkbox', 'cortext' ), icon: check },
	{ value: 'relation', label: __( 'Relation', 'cortext' ), icon: link },
	{ value: 'rollup', label: __( 'Rollup', 'cortext' ), icon: backup },
	{ value: 'url', label: __( 'URL', 'cortext' ), icon: globe },
	{ value: 'email', label: __( 'Email', 'cortext' ), icon: atSymbol },
];

export function fieldTypeDefinition( type ) {
	return FIELD_TYPES.find( ( fieldType ) => fieldType.value === type );
}

export function fieldTypeLabel( type ) {
	return fieldTypeDefinition( type )?.label;
}

export function FieldTypeIcon( { type, className = '' } ) {
	const definition = fieldTypeDefinition( type );
	if ( ! definition?.icon ) {
		return null;
	}

	return (
		<span
			className={ `cortext-field-type-icon ${ className }`.trim() }
			data-cortext-field-type={ type }
			aria-hidden="true"
		>
			<Icon icon={ definition.icon } />
		</span>
	);
}
