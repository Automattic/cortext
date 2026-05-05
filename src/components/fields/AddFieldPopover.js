import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Icon,
	Notice,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';
import { useEntityRecords } from '@wordpress/core-data';
import { useMemo, useState } from '@wordpress/element';
import {
	atSymbol,
	calendar,
	check,
	formatListBullets,
	globe,
	link,
	tag,
	typography,
} from '@wordpress/icons';

import { COLLECTION_QUERY } from '../../collections';
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
	{ value: 'relation', label: __( 'Relation', 'cortext' ), icon: link },
	{ value: 'url', label: __( 'URL', 'cortext' ), icon: globe },
	{ value: 'email', label: __( 'Email', 'cortext' ), icon: atSymbol },
];

const RELATION_LIMIT_OPTIONS = [
	{ value: 'many', label: __( 'No limit', 'cortext' ) },
	{ value: 'one', label: __( '1 page', 'cortext' ) },
];

function titleOf( record ) {
	return record?.title?.raw || record?.title?.rendered || `#${ record?.id }`;
}

function fieldTypeLabel( type ) {
	return FIELD_TYPES.find( ( fieldType ) => fieldType.value === type )?.label;
}

function RelationConfig( {
	collectionId,
	collections,
	title,
	fallbackTitle,
	isBusy,
	onCreate,
	onBack,
	onError,
	run,
} ) {
	const [ targetCollectionId, setTargetCollectionId ] = useState( '' );
	const [ relationMultiple, setRelationMultiple ] = useState( true );
	const [ reverseTitle, setReverseTitle ] = useState( '' );
	const [ reverseMultiple, setReverseMultiple ] = useState( true );
	const [ showReverseOptions, setShowReverseOptions ] = useState( true );

	const options = useMemo(
		() => [
			{ value: '', label: __( 'Choose collection…', 'cortext' ) },
			...( collections ?? [] ).map( ( collection ) => ( {
				value: String( collection.id ),
				label: titleOf( collection ),
			} ) ),
		],
		[ collections ]
	);

	const sourceCollection = collections?.find(
		( collection ) => collection.id === collectionId
	);
	const defaultReverseTitle = sourceCollection
		? sprintf(
				/* translators: %s: collection title */
				__( 'Related %s', 'cortext' ),
				titleOf( sourceCollection )
		  )
		: __( 'Related items', 'cortext' );

	const submit = async () => {
		if ( ! targetCollectionId || isBusy ) {
			return;
		}
		try {
			const created = await run( {
				title: title.trim() || fallbackTitle,
				type: 'relation',
				related_collection_id: Number( targetCollectionId ),
				relation_multiple: relationMultiple,
				reverse_title: reverseTitle.trim() || defaultReverseTitle,
				reverse_multiple: reverseMultiple,
			} );
			onCreate?.( created );
		} catch ( apiError ) {
			onError(
				apiError?.message ||
					__( 'Relation could not be created.', 'cortext' )
			);
		}
	};

	return (
		<div className="cortext-add-field-popover__config">
			<SelectControl
				label={ __( 'Related to', 'cortext' ) }
				value={ targetCollectionId }
				options={ options }
				onChange={ setTargetCollectionId }
				disabled={ isBusy }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			<SelectControl
				label={ __( 'Limit', 'cortext' ) }
				value={ relationMultiple ? 'many' : 'one' }
				options={ RELATION_LIMIT_OPTIONS }
				onChange={ ( next ) => setRelationMultiple( next === 'many' ) }
				disabled={ isBusy }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			<ToggleControl
				label={ __( 'Add related property', 'cortext' ) }
				checked={ showReverseOptions }
				onChange={ setShowReverseOptions }
				disabled={ isBusy }
				__nextHasNoMarginBottom
			/>
			{ showReverseOptions ? (
				<>
					<TextControl
						label={ __( 'Related property name', 'cortext' ) }
						placeholder={ defaultReverseTitle }
						value={ reverseTitle }
						onChange={ setReverseTitle }
						disabled={ isBusy }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
					<SelectControl
						label={ __( 'Related property limit', 'cortext' ) }
						value={ reverseMultiple ? 'many' : 'one' }
						options={ RELATION_LIMIT_OPTIONS }
						onChange={ ( next ) =>
							setReverseMultiple( next === 'many' )
						}
						disabled={ isBusy }
						__next40pxDefaultSize
						__nextHasNoMarginBottom
					/>
				</>
			) : null }
			<div className="cortext-add-field-popover__actions">
				<Button
					variant="tertiary"
					onClick={ onBack }
					disabled={ isBusy }
				>
					{ __( 'Back', 'cortext' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ submit }
					isBusy={ isBusy }
					disabled={ isBusy || ! targetCollectionId }
				>
					{ __( 'Add relation', 'cortext' ) }
				</Button>
			</div>
		</div>
	);
}

export default function AddFieldPopover( { collectionId, onCreate } ) {
	const [ title, setTitle ] = useState( '' );
	const [ submitError, setSubmitError ] = useState( '' );
	const [ configType, setConfigType ] = useState( null );

	const { run, isBusy, error } = useCreateField( collectionId );
	const { records: collections } = useEntityRecords(
		'postType',
		'crtxt_collection',
		COLLECTION_QUERY
	);

	const submit = async ( chosenType ) => {
		if ( isBusy ) {
			return;
		}
		setSubmitError( '' );
		if ( chosenType === 'relation' ) {
			setConfigType( chosenType );
			return;
		}
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
	const configuredType = FIELD_TYPES.find(
		( fieldType ) => fieldType.value === configType
	);
	const fallbackTitle = configuredType
		? configuredType.label
		: fieldTypeLabel( 'text' );

	let configuration = null;
	if ( configType === 'relation' ) {
		configuration = (
			<RelationConfig
				collectionId={ collectionId }
				collections={ collections ?? [] }
				title={ title }
				fallbackTitle={ fallbackTitle }
				isBusy={ isBusy }
				run={ run }
				onCreate={ onCreate }
				onBack={ () => setConfigType( null ) }
				onError={ setSubmitError }
			/>
		);
	}

	return (
		<div className="cortext-add-field-popover">
			{ errorMessage ? (
				<Notice status="error" isDismissible={ false }>
					{ errorMessage }
				</Notice>
			) : null }
			<TextControl
				label={
					configType
						? __( 'Relation name', 'cortext' )
						: __( 'Name', 'cortext' )
				}
				placeholder={
					configType
						? __( 'Relation name', 'cortext' )
						: __( 'Type property name…', 'cortext' )
				}
				value={ title }
				onChange={ setTitle }
				onKeyDown={ ( event ) => {
					if ( event.key === 'Enter' && ! isBusy && ! configType ) {
						event.preventDefault();
						submit( 'text' );
					}
				} }
				disabled={ isBusy }
				hideLabelFromVision={ Boolean( configType ) }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			{ configuration ? (
				configuration
			) : (
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
			) }
		</div>
	);
}
