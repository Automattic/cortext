import { __ } from '@wordpress/i18n';
import { Icon, Notice, TextControl } from '@wordpress/components';
import { useState } from '@wordpress/element';
import {
	atSymbol,
	calendar,
	check,
	formatListBullets,
	globe,
	tag,
	typography,
} from '@wordpress/icons';

import { useCreateField } from '../../hooks/useFieldMutations';

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
// Notion's separation between Date and Date & time.
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

const FIELD_TYPES = [
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
	{ value: 'url', label: __( 'URL', 'cortext' ), icon: globe },
	{ value: 'email', label: __( 'Email', 'cortext' ), icon: atSymbol },
];

export default function AddFieldPopover( { collectionId, onCreate } ) {
	const [ title, setTitle ] = useState( '' );
	const [ submitError, setSubmitError ] = useState( '' );

	const { run, isBusy, error } = useCreateField( collectionId );

	const submit = async ( chosenType ) => {
		if ( isBusy ) {
			return;
		}
		setSubmitError( '' );
		// Notion-style fallback: an empty name is allowed; the field
		// title defaults to the type label ("Text", "Number", …) and
		// the user can rename later via the column header dropdown.
		const trimmed = title.trim();
		const fallback =
			FIELD_TYPES.find( ( t ) => t.value === chosenType )?.label ||
			chosenType;
		try {
			// Select / multi-select fields are created without
			// pre-defined options. Options can be edited via wp-admin
			// today; a future field-edit dialog will bring it inline
			// (tech-debt.md#18).
			const created = await run( {
				title: trimmed || fallback,
				type: chosenType,
			} );
			onCreate?.( created );
		} catch ( apiError ) {
			setSubmitError(
				apiError?.message ||
					__( 'Field could not be created.', 'cortext' )
			);
		}
	};

	const errorMessage = submitError || error?.message;

	return (
		<div className="cortext-add-field-popover">
			{ errorMessage ? (
				<Notice status="error" isDismissible={ false }>
					{ errorMessage }
				</Notice>
			) : null }
			<TextControl
				label={ __( 'Name', 'cortext' ) }
				placeholder={ __( 'Type property name…', 'cortext' ) }
				value={ title }
				onChange={ setTitle }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Enter' && ! isBusy ) {
						event.preventDefault();
						submit( 'text' );
					}
				} }
				disabled={ isBusy }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			<div className="cortext-add-field-popover__type-section">
				<span className="cortext-add-field-popover__section-title">
					{ __( 'Type', 'cortext' ) }
				</span>
				<div className="cortext-add-field-popover__type-grid">
					{ FIELD_TYPES.map( ( option ) => (
						<button
							key={ option.value }
							type="button"
							className="cortext-add-field-popover__type-button"
							onClick={ () => submit( option.value ) }
							disabled={ isBusy }
						>
							<Icon
								icon={ option.icon }
								className="cortext-add-field-popover__type-icon"
							/>
							<span>{ option.label }</span>
						</button>
					) ) }
				</div>
			</div>
		</div>
	);
}
