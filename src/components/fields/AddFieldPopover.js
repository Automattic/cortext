import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	ComboboxControl,
	Notice,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';
import { useEntityRecord } from '@wordpress/core-data';
import { useMemo, useState } from '@wordpress/element';

import './AddFieldPopover.scss';

import { DOCUMENT_POST_TYPE } from '../../collections';
import useCollectionSearch from '../../hooks/useCollectionSearch';
import { useCreateField } from '../../hooks/useFieldMutations';
import { FIELD_TYPES, FieldTypeIcon, fieldTypeLabel } from './fieldTypes';
import FormulaConfig from './FormulaConfig';
import RollupConfig, { titleOf } from './RollupConfig';

const RELATION_LIMIT_OPTIONS = [
	{ value: 'many', label: __( 'No limit', 'cortext' ) },
	{ value: 'one', label: __( '1 document', 'cortext' ) },
];

function RelationConfig( {
	collectionId,
	title,
	fallbackTitle,
	isBusy,
	onCreate,
	onBack,
	onError,
	run,
} ) {
	const [ target, setTarget ] = useState( null );
	const [ targetSearch, setTargetSearch ] = useState( '' );
	const [ relationMultiple, setRelationMultiple ] = useState( true );
	const [ reverseTitle, setReverseTitle ] = useState( '' );
	const [ reverseMultiple, setReverseMultiple ] = useState( true );
	const [ showReverseOptions, setShowReverseOptions ] = useState( true );
	const targetCollectionId = target?.value ?? '';

	const { records: matches, isResolving: isSearching } =
		useCollectionSearch( targetSearch );
	const options = useMemo( () => {
		const found = ( matches ?? [] ).map( ( collection ) => ( {
			value: String( collection.id ),
			label: titleOf( collection ),
		} ) );
		// Keep the chosen collection listed after a later search drops it, so
		// the combobox can still show its label.
		if ( target && ! found.some( ( o ) => o.value === target.value ) ) {
			found.unshift( target );
		}
		return found;
	}, [ matches, target ] );

	const { record: sourceCollection } = useEntityRecord(
		'postType',
		DOCUMENT_POST_TYPE,
		collectionId
	);
	const defaultReverseTitle = sourceCollection
		? sprintf(
				/* translators: %s: collection title */
				__( 'Related %s', 'cortext' ),
				titleOf( sourceCollection )
		  )
		: __( 'Related documents', 'cortext' );

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
					__( "Couldn't create the relation.", 'cortext' )
			);
		}
	};

	return (
		<div className="cortext-add-field-popover__config">
			<ComboboxControl
				label={ __( 'Related to', 'cortext' ) }
				placeholder={ __( 'Choose collection…', 'cortext' ) }
				value={ targetCollectionId }
				options={ options }
				onChange={ ( value ) =>
					setTarget(
						options.find( ( option ) => option.value === value ) ??
							null
					)
				}
				onFilterValueChange={ setTargetSearch }
				isLoading={ isSearching }
				__nextHasNoMarginBottom
			/>
			<SelectControl
				label={ __( 'Limit', 'cortext' ) }
				value={ relationMultiple ? 'many' : 'one' }
				options={ RELATION_LIMIT_OPTIONS }
				onChange={ ( next ) => setRelationMultiple( next === 'many' ) }
				disabled={ isBusy }
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

	const submit = async ( chosenType ) => {
		if ( isBusy ) {
			return;
		}
		setSubmitError( '' );
		if (
			chosenType === 'relation' ||
			chosenType === 'rollup' ||
			chosenType === 'formula'
		) {
			setConfigType( chosenType );
			return;
		}
		// Empty-name fallback: an empty name is allowed; the field
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
			// (tech-debt.md#td-field-management-panel).
			const created = await run( {
				title: trimmed || fallback,
				type: chosenType,
			} );
			onCreate?.( created );
		} catch ( apiError ) {
			setSubmitError(
				apiError?.message ||
					__( "Couldn't create the property.", 'cortext' )
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
	let nameLabel = __( 'Name', 'cortext' );
	let namePlaceholder = __( 'Type property name…', 'cortext' );
	if ( configType === 'relation' ) {
		nameLabel = __( 'Relation name', 'cortext' );
		namePlaceholder = __( 'Relation name', 'cortext' );
	} else if ( configType === 'rollup' ) {
		nameLabel = __( 'Rollup name', 'cortext' );
		namePlaceholder = __( 'Rollup name', 'cortext' );
	} else if ( configType === 'formula' ) {
		nameLabel = __( 'Formula name', 'cortext' );
		namePlaceholder = __( 'Formula name', 'cortext' );
	}

	let configuration = null;
	if ( configType === 'relation' ) {
		configuration = (
			<RelationConfig
				collectionId={ collectionId }
				title={ title }
				fallbackTitle={ fallbackTitle }
				isBusy={ isBusy }
				run={ run }
				onCreate={ onCreate }
				onBack={ () => setConfigType( null ) }
				onError={ setSubmitError }
			/>
		);
	} else if ( configType === 'rollup' ) {
		configuration = (
			<RollupConfig
				fallbackTitle={ fallbackTitle }
				isBusy={ isBusy }
				onBack={ () => setConfigType( null ) }
				onError={ setSubmitError }
				onSubmit={ async ( {
					relationFieldId,
					targetFieldId,
					aggregator,
					defaultTitle,
				} ) => {
					const payload = {
						title: title.trim() || defaultTitle,
						type: 'rollup',
						rollup_relation_field_id: relationFieldId,
						rollup_aggregator: aggregator,
					};
					if ( targetFieldId ) {
						payload.rollup_target_field_id = targetFieldId;
					}
					const created = await run( payload );
					onCreate?.( created );
				} }
			/>
		);
	} else if ( configType === 'formula' ) {
		configuration = (
			<FormulaConfig
				isBusy={ isBusy }
				onBack={ () => setConfigType( null ) }
				onError={ setSubmitError }
				onSubmit={ async ( expression ) => {
					const created = await run( {
						title: title.trim() || fallbackTitle,
						type: 'formula',
						expression,
					} );
					onCreate?.( created );
				} }
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
				label={ nameLabel }
				placeholder={ namePlaceholder }
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
								<FieldTypeIcon
									type={ option.value }
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
