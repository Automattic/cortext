import { __, sprintf } from '@wordpress/i18n';
import {
	Button,
	Notice,
	SelectControl,
	TextControl,
	ToggleControl,
} from '@wordpress/components';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useEffect, useMemo, useState } from '@wordpress/element';

import './AddFieldPopover.scss';

import { COLLECTION_QUERY } from '../../collections';
import { buildFieldListQuery } from '../../hooks/useCollectionFields';
import { useCollectionFieldsContext } from '../CollectionFieldsContext';
import { useCreateField } from '../../hooks/useFieldMutations';
import { FIELD_TYPES, FieldTypeIcon, fieldTypeLabel } from './fieldTypes';

const RELATION_LIMIT_OPTIONS = [
	{ value: 'many', label: __( 'No limit', 'cortext' ) },
	{ value: 'one', label: __( '1 page', 'cortext' ) },
];

const ROLLUP_AGGREGATORS = [
	{ value: 'show_original', label: __( 'Show original', 'cortext' ) },
	{ value: 'show_unique', label: __( 'Show unique values', 'cortext' ) },
	{ value: 'count', label: __( 'Count all', 'cortext' ) },
	{ value: 'count_values', label: __( 'Count values', 'cortext' ) },
	{ value: 'count_unique', label: __( 'Count unique values', 'cortext' ) },
	{ value: 'empty', label: __( 'Count empty', 'cortext' ) },
	{ value: 'not_empty', label: __( 'Count not empty', 'cortext' ) },
	{ value: 'percent_empty', label: __( 'Percent empty', 'cortext' ) },
	{ value: 'percent_not_empty', label: __( 'Percent not empty', 'cortext' ) },
];

const ROLLUP_NUMBER_AGGREGATORS = [
	{ value: 'sum', label: __( 'Sum', 'cortext' ) },
	{ value: 'avg', label: __( 'Average', 'cortext' ) },
	{ value: 'median', label: __( 'Median', 'cortext' ) },
	{ value: 'min', label: __( 'Min', 'cortext' ) },
	{ value: 'max', label: __( 'Max', 'cortext' ) },
	{ value: 'range', label: __( 'Range', 'cortext' ) },
];

const ROLLUP_DATE_AGGREGATORS = [
	{ value: 'earliest', label: __( 'Earliest date', 'cortext' ) },
	{ value: 'latest', label: __( 'Latest date', 'cortext' ) },
	{ value: 'date_range', label: __( 'Date range', 'cortext' ) },
];

function titleOf( record ) {
	return record?.title?.raw || record?.title?.rendered || `#${ record?.id }`;
}

function rollupAggregatorLabel( aggregator ) {
	return (
		[
			...ROLLUP_AGGREGATORS,
			...ROLLUP_NUMBER_AGGREGATORS,
			...ROLLUP_DATE_AGGREGATORS,
		].find( ( option ) => option.value === aggregator )?.label ?? aggregator
	);
}

function rollupAggregatorOptionsForTarget( type ) {
	const options = [ ...ROLLUP_AGGREGATORS ];
	if ( type === 'number' ) {
		options.push( ...ROLLUP_NUMBER_AGGREGATORS );
	}
	if ( type === 'date' || type === 'datetime' ) {
		options.push( ...ROLLUP_DATE_AGGREGATORS );
	}
	return options;
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

function RollupConfig( {
	title,
	fallbackTitle,
	isBusy,
	onCreate,
	onBack,
	onError,
	run,
} ) {
	const { fields } = useCollectionFieldsContext();
	const relationFields = fields.filter(
		( field ) => field.cortextType === 'relation'
	);
	const [ relationFieldId, setRelationFieldId ] = useState( '' );
	const [ aggregator, setAggregator ] = useState( 'count' );
	const [ targetFieldId, setTargetFieldId ] = useState( '' );

	const selectedRelation = relationFields.find(
		( field ) => String( field.recordId ) === relationFieldId
	);
	const targetCollectionId = selectedRelation?.relatedCollectionId;
	const { record: targetCollection } = useEntityRecord(
		'postType',
		'crtxt_collection',
		targetCollectionId ?? 0
	);
	const targetFieldIds = useMemo( () => {
		const raw = targetCollection?.meta?.fields;
		return Array.isArray( raw )
			? raw.map( ( id ) => Number( id ) ).filter( Boolean )
			: [];
	}, [ targetCollection ] );
	const { records: targetFields } = useEntityRecords(
		'postType',
		'crtxt_field',
		buildFieldListQuery( targetFieldIds ),
		{ enabled: targetFieldIds.length > 0 }
	);
	const selectedTargetField = targetFields?.find(
		( field ) => String( field.id ) === targetFieldId
	);

	const targetOptions = useMemo(
		() => [
			{ value: '', label: __( 'Choose field…', 'cortext' ) },
			...( targetFields ?? [] )
				.filter( ( field ) => field.meta?.type !== 'rollup' )
				.map( ( field ) => ( {
					value: String( field.id ),
					label: titleOf( field ),
				} ) ),
		],
		[ targetFields ]
	);
	const aggregatorOptions = useMemo(
		() =>
			rollupAggregatorOptionsForTarget( selectedTargetField?.meta?.type ),
		[ selectedTargetField ]
	);
	const targetRequired = aggregator !== 'count';
	const relationOptions = [
		{ value: '', label: __( 'Choose relation…', 'cortext' ) },
		...relationFields.map( ( field ) => ( {
			value: String( field.recordId ),
			label: field.label,
		} ) ),
	];
	const defaultRollupTitle = useMemo( () => {
		const collectionLabel = targetCollection
			? titleOf( targetCollection )
			: selectedRelation?.label;
		if ( ! collectionLabel ) {
			return fallbackTitle;
		}
		const aggregatorLabel = rollupAggregatorLabel( aggregator );
		if ( selectedTargetField ) {
			return sprintf(
				/* translators: 1: collection title, 2: field title, 3: rollup aggregation label */
				__( '%1$s / %2$s (%3$s)', 'cortext' ),
				collectionLabel,
				titleOf( selectedTargetField ),
				aggregatorLabel
			);
		}
		return sprintf(
			/* translators: 1: collection title, 2: rollup aggregation label */
			__( '%1$s (%2$s)', 'cortext' ),
			collectionLabel,
			aggregatorLabel
		);
	}, [
		aggregator,
		fallbackTitle,
		selectedRelation,
		selectedTargetField,
		targetCollection,
	] );

	useEffect( () => {
		if ( relationFields.length === 1 && ! relationFieldId ) {
			setRelationFieldId( String( relationFields[ 0 ].recordId ) );
		}
	}, [ relationFields, relationFieldId ] );

	useEffect( () => {
		if ( targetFieldId ) {
			return;
		}
		const compatibleTargets = targetOptions.slice( 1 );
		if ( compatibleTargets.length === 1 ) {
			setTargetFieldId( compatibleTargets[ 0 ].value );
			setAggregator( 'show_original' );
		}
	}, [ targetFieldId, targetOptions ] );

	useEffect( () => {
		if ( ! targetFieldId ) {
			return;
		}
		if (
			! aggregatorOptions.some(
				( option ) => option.value === aggregator
			)
		) {
			setAggregator( 'show_original' );
		}
	}, [ aggregator, aggregatorOptions, targetFieldId ] );

	const submit = async () => {
		if (
			! relationFieldId ||
			( targetRequired && ! targetFieldId ) ||
			isBusy
		) {
			return;
		}
		try {
			const payload = {
				title: title.trim() || defaultRollupTitle,
				type: 'rollup',
				rollup_relation_field_id: Number( relationFieldId ),
				rollup_aggregator: aggregator,
			};
			if ( targetFieldId ) {
				payload.rollup_target_field_id = Number( targetFieldId );
			}
			const created = await run( payload );
			onCreate?.( created );
		} catch ( apiError ) {
			onError(
				apiError?.message ||
					__( 'Rollup could not be created.', 'cortext' )
			);
		}
	};

	return (
		<div className="cortext-add-field-popover__config">
			{ relationFields.length === 0 ? (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'Create a relation before adding a rollup.',
						'cortext'
					) }
				</Notice>
			) : null }
			<SelectControl
				label={ __( 'Relation', 'cortext' ) }
				value={ relationFieldId }
				options={ relationOptions }
				onChange={ ( next ) => {
					setRelationFieldId( next );
					setTargetFieldId( '' );
					setAggregator( 'count' );
				} }
				disabled={ isBusy || relationFields.length === 0 }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			<SelectControl
				label={ __( 'Target property', 'cortext' ) }
				value={ targetFieldId }
				options={ targetOptions }
				onChange={ ( next ) => {
					setTargetFieldId( next );
					setAggregator( 'show_original' );
				} }
				disabled={
					isBusy || ! relationFieldId || targetOptions.length <= 1
				}
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
			<SelectControl
				label={ __( 'Calculate', 'cortext' ) }
				value={ aggregator }
				options={ aggregatorOptions }
				onChange={ setAggregator }
				disabled={ isBusy || ! relationFieldId }
				__next40pxDefaultSize
				__nextHasNoMarginBottom
			/>
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
					disabled={
						isBusy ||
						! relationFieldId ||
						( targetRequired && ! targetFieldId )
					}
				>
					{ __( 'Create rollup', 'cortext' ) }
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
		if ( chosenType === 'relation' || chosenType === 'rollup' ) {
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
	let nameLabel = __( 'Name', 'cortext' );
	let namePlaceholder = __( 'Type property name…', 'cortext' );
	if ( configType === 'relation' ) {
		nameLabel = __( 'Relation name', 'cortext' );
		namePlaceholder = __( 'Relation name', 'cortext' );
	} else if ( configType === 'rollup' ) {
		nameLabel = __( 'Rollup name', 'cortext' );
		namePlaceholder = __( 'Rollup name', 'cortext' );
	}

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
	} else if ( configType === 'rollup' ) {
		configuration = (
			<RollupConfig
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
