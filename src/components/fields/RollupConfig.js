import { __, sprintf } from '@wordpress/i18n';
import { Button, Notice, SelectControl } from '@wordpress/components';
import { useEntityRecord, useEntityRecords } from '@wordpress/core-data';
import { useEffect, useMemo, useState } from '@wordpress/element';

import { buildFieldListQuery } from '../../hooks/useCollectionFields';
import { useCollectionFieldsContext } from '../CollectionFieldsContext';

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

export function titleOf( record ) {
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

// Picks the relation, target field and calculation for a rollup. Used both
// when adding a rollup and when changing an existing one, so it only reports
// the chosen settings; the caller decides what to save.
export default function RollupConfig( {
	initialRelationFieldId = '',
	initialTargetFieldId = '',
	initialAggregator = 'count',
	fallbackTitle = '',
	isBusy = false,
	errorMessage = '',
	submitLabel = __( 'Create rollup', 'cortext' ),
	backLabel = __( 'Back', 'cortext' ),
	onBack,
	onError,
	onSubmit,
} ) {
	const { fields } = useCollectionFieldsContext();
	const relationFields = fields.filter(
		( field ) => field.cortextType === 'relation'
	);
	// A relation outside this collection (a duplicated collection's rollup
	// still points at the original's) can't be offered, so start unpicked.
	const initialRelationIsHere = relationFields.some(
		( field ) =>
			String( field.recordId ) === String( initialRelationFieldId )
	);
	const [ relationFieldId, setRelationFieldId ] = useState(
		initialRelationIsHere ? String( initialRelationFieldId ) : ''
	);
	const [ aggregator, setAggregator ] = useState( initialAggregator );
	const [ targetFieldId, setTargetFieldId ] = useState(
		initialRelationIsHere && initialTargetFieldId
			? String( initialTargetFieldId )
			: ''
	);

	const selectedRelation = relationFields.find(
		( field ) => String( field.recordId ) === relationFieldId
	);
	const targetCollectionId = selectedRelation?.relatedCollectionId;
	const { record: targetCollection } = useEntityRecord(
		'postType',
		'crtxt_document',
		targetCollectionId ?? 0
	);
	const targetFieldIds = useMemo( () => {
		const raw = targetCollection?.meta?.cortext_fields;
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
			{ value: '', label: __( 'Choose property…', 'cortext' ) },
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
			await onSubmit( {
				relationFieldId: Number( relationFieldId ),
				targetFieldId: targetFieldId ? Number( targetFieldId ) : null,
				aggregator,
				defaultTitle: defaultRollupTitle,
			} );
		} catch ( apiError ) {
			onError?.(
				apiError?.message ||
					__( "Couldn't save the rollup.", 'cortext' )
			);
		}
	};

	return (
		<div className="cortext-add-field-popover__config">
			{ errorMessage ? (
				<Notice status="error" isDismissible={ false }>
					{ errorMessage }
				</Notice>
			) : null }
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
				__nextHasNoMarginBottom
			/>
			<SelectControl
				label={ __( 'Calculate', 'cortext' ) }
				value={ aggregator }
				options={ aggregatorOptions }
				onChange={ setAggregator }
				disabled={ isBusy || ! relationFieldId }
				__nextHasNoMarginBottom
			/>
			<div className="cortext-add-field-popover__actions">
				<Button
					variant="tertiary"
					onClick={ onBack }
					disabled={ isBusy }
				>
					{ backLabel }
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
					{ submitLabel }
				</Button>
			</div>
		</div>
	);
}
