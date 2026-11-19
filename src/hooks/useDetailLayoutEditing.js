import { __ } from '@wordpress/i18n';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { useCallback, useEffect, useMemo, useState } from '@wordpress/element';

import { HIDDEN_PROPERTIES_DROP_TARGET } from '../components/RowProperties';
import { TITLE_FIELD_ID } from '../components/dataViewColumns';
import {
	detailFieldsFromEntries,
	detailLayoutMetaFromEntries,
	reorderVisibleDetailEntries,
} from './detailLayout';

function entriesWithHiddenLast( entries ) {
	const safeEntries = Array.isArray( entries ) ? entries : [];
	return [
		...safeEntries.filter( ( entry ) => entry?.visible !== false ),
		...safeEntries.filter( ( entry ) => entry?.visible === false ),
	];
}

function reconcileOptimisticEntries( optimisticEntries, currentEntries ) {
	if ( ! Array.isArray( optimisticEntries ) ) {
		return currentEntries;
	}
	const currentByField = new Map(
		( Array.isArray( currentEntries ) ? currentEntries : [] ).map(
			( entry ) => [ entry.field, entry ]
		)
	);
	const optimisticFields = new Set();
	const reconciledEntries = optimisticEntries.filter( ( entry ) => {
		if (
			! currentByField.has( entry.field ) ||
			optimisticFields.has( entry.field )
		) {
			return false;
		}
		optimisticFields.add( entry.field );
		return true;
	} );
	for ( const entry of currentByField.values() ) {
		if ( ! optimisticFields.has( entry.field ) ) {
			reconciledEntries.push( entry );
		}
	}
	return reconciledEntries;
}

function reorderDetailLayoutEntries( entries, activeField, overField ) {
	const safeEntries = Array.isArray( entries ) ? entries : [];
	const from = safeEntries.findIndex(
		( entry ) => entry.field === activeField
	);
	const isHiddenGroupDrop = overField === HIDDEN_PROPERTIES_DROP_TARGET;
	const firstHiddenIndex = safeEntries.findIndex(
		( entry ) => entry.visible === false
	);
	let to = safeEntries.findIndex( ( entry ) => entry.field === overField );
	if ( isHiddenGroupDrop ) {
		to = firstHiddenIndex === -1 ? safeEntries.length : firstHiddenIndex;
	}
	if ( from < 0 || to < 0 || ( from === to && ! isHiddenGroupDrop ) ) {
		return safeEntries;
	}
	const activeIsHidden = safeEntries[ from ]?.visible === false;
	const overIsHidden = safeEntries[ to ]?.visible === false;
	const shouldHideActive =
		! activeIsHidden && ( isHiddenGroupDrop || overIsHidden );
	const shouldShowActive =
		activeIsHidden && ( isHiddenGroupDrop || ! overIsHidden );
	const nextEntries = [ ...safeEntries ];
	const [ moved ] = nextEntries.splice( from, 1 );
	let nextMoved = moved;
	if ( shouldHideActive ) {
		nextMoved = { ...moved, visible: false };
	} else if ( shouldShowActive ) {
		nextMoved = { ...moved, visible: true };
	}
	const insertAt = isHiddenGroupDrop && from < to ? to - 1 : to;
	nextEntries.splice( insertAt, 0, nextMoved );
	return nextEntries;
}

// Owns one collection's detail-layout editing: which fields show, their order,
// inline and edit-mode reordering, hide/show toggles, and the optimistic save
// to that collection's `cortext_detail_layout`. The `isLayoutEditing` toggle is
// shared (one button drives every group), so a multi-collection row can reorder
// each collection's properties independently. Used by the document-properties
// block for the source collection and by each additional collection group.
export default function useDetailLayoutEditing( {
	collectionId,
	fields = [],
	allFields,
	detailLayoutEntries,
	rowId,
	isLayoutEditing,
	excludedFieldIds,
} ) {
	const [ optimisticEntries, setOptimisticEntries ] = useState( null );
	const [ saveError, setSaveError ] = useState( null );
	const { saveEntityRecord } = useDispatch( coreStore );

	const canEditLayout = useSelect(
		( select ) =>
			collectionId
				? select( coreStore ).canUser( 'update', {
						kind: 'postType',
						name: 'crtxt_document',
						id: collectionId,
				  } ) === true
				: false,
		[ collectionId ]
	);
	const isSavingLayout = useSelect(
		( select ) =>
			collectionId
				? select( coreStore ).isSavingEntityRecord(
						'postType',
						'crtxt_document',
						collectionId
				  )
				: false,
		[ collectionId ]
	);

	const visibleFields = useMemo(
		() => ( Array.isArray( fields ) ? fields : [] ),
		[ fields ]
	);
	const layoutFields = useMemo(
		() => ( Array.isArray( allFields ) ? allFields : visibleFields ),
		[ allFields, visibleFields ]
	);
	const isExcludedField = useCallback(
		( field ) => excludedFieldIds?.has?.( field?.id ) === true,
		[ excludedFieldIds ]
	);
	const allLayoutPropertyFields = useMemo(
		() => layoutFields.filter( ( field ) => field.id !== TITLE_FIELD_ID ),
		[ layoutFields ]
	);
	const layoutPropertyFields = useMemo(
		() =>
			allLayoutPropertyFields.filter(
				( field ) => ! isExcludedField( field )
			),
		[ allLayoutPropertyFields, isExcludedField ]
	);
	const currentEntries = useMemo(
		() =>
			Array.isArray( detailLayoutEntries )
				? detailLayoutEntries
				: allLayoutPropertyFields.map( ( field ) => ( {
						field: field.id,
						visible: true,
				  } ) ),
		[ allLayoutPropertyFields, detailLayoutEntries ]
	);

	useEffect( () => {
		setOptimisticEntries( null );
	}, [ collectionId, rowId ] );
	// Clear a stale save error when (re)entering edit mode; errors raised during
	// editing stay visible because this only fires on the transition.
	useEffect( () => {
		if ( isLayoutEditing ) {
			setSaveError( null );
		}
	}, [ isLayoutEditing ] );

	const saveLayoutEntries = useCallback(
		async ( nextEntries ) => {
			if ( ! collectionId || ! canEditLayout ) {
				return;
			}
			const previousOptimisticEntries = optimisticEntries;
			setOptimisticEntries( nextEntries );
			setSaveError( null );
			try {
				await saveEntityRecord(
					'postType',
					'crtxt_document',
					{
						id: collectionId,
						meta: {
							cortext_detail_layout:
								detailLayoutMetaFromEntries( nextEntries ),
						},
					},
					{ throwOnError: true }
				);
			} catch ( error ) {
				setOptimisticEntries( previousOptimisticEntries );
				setSaveError(
					error?.message ??
						__( "Couldn't save the property layout.", 'cortext' )
				);
			}
		},
		[ canEditLayout, collectionId, optimisticEntries, saveEntityRecord ]
	);
	const handleInlineLayoutReorder = useCallback(
		( activeField, overField ) => {
			if ( ! canEditLayout || isSavingLayout ) {
				return;
			}
			const baseEntries = reconcileOptimisticEntries(
				optimisticEntries,
				currentEntries
			);
			const nextEntries = reorderVisibleDetailEntries(
				baseEntries,
				activeField,
				overField
			);
			if ( nextEntries === baseEntries ) {
				return;
			}
			saveLayoutEntries( nextEntries );
		},
		[
			canEditLayout,
			currentEntries,
			isSavingLayout,
			optimisticEntries,
			saveLayoutEntries,
		]
	);
	const layoutEntries = useMemo(
		() => reconcileOptimisticEntries( optimisticEntries, currentEntries ),
		[ currentEntries, optimisticEntries ]
	);
	const inlineLayoutFields = useMemo( () => {
		const nextFields = optimisticEntries
			? detailFieldsFromEntries( layoutFields, layoutEntries )
			: visibleFields;
		return nextFields.filter( ( field ) => ! isExcludedField( field ) );
	}, [
		isExcludedField,
		layoutEntries,
		layoutFields,
		optimisticEntries,
		visibleFields,
	] );
	const layoutEditingFields = useMemo( () => {
		const fieldsById = new Map(
			layoutFields.map( ( field ) => [ field.id, field ] )
		);
		return entriesWithHiddenLast( layoutEntries )
			.map( ( entry ) => {
				const field = fieldsById.get( entry.field );
				return field
					? {
							...field,
							cortextDetailVisible: entry.visible !== false,
					  }
					: null;
			} )
			.filter(
				( field ) => Boolean( field ) && ! isExcludedField( field )
			);
	}, [ isExcludedField, layoutEntries, layoutFields ] );
	const handleLayoutEditReorder = useCallback(
		( activeField, overField ) => {
			if ( ! canEditLayout ) {
				return;
			}
			const visibleOrderEntries = entriesWithHiddenLast( layoutEntries );
			const nextEntries = reorderDetailLayoutEntries(
				visibleOrderEntries,
				activeField,
				overField
			);
			if ( nextEntries === visibleOrderEntries ) {
				return;
			}
			saveLayoutEntries( nextEntries );
		},
		[ canEditLayout, layoutEntries, saveLayoutEntries ]
	);
	const handleLayoutVisibilityToggle = useCallback(
		( fieldId ) => {
			if ( ! canEditLayout ) {
				return;
			}
			const nextEntries = layoutEntries.map( ( entry ) =>
				entry.field === fieldId
					? { ...entry, visible: entry.visible === false }
					: entry
			);
			saveLayoutEntries( nextEntries );
		},
		[ canEditLayout, layoutEntries, saveLayoutEntries ]
	);

	const isLayoutEditingEnabled = isLayoutEditing && canEditLayout;
	const propertyFieldsForDisplay = isLayoutEditingEnabled
		? layoutEditingFields
		: inlineLayoutFields;
	const visiblePropertyCount = inlineLayoutFields.filter(
		( field ) => field.id !== TITLE_FIELD_ID
	).length;
	let layoutReorderHandler;
	if ( isLayoutEditingEnabled ) {
		layoutReorderHandler = handleLayoutEditReorder;
	} else if ( canEditLayout ) {
		layoutReorderHandler = handleInlineLayoutReorder;
	}
	const layoutVisibilityHandler = isLayoutEditingEnabled
		? handleLayoutVisibilityToggle
		: undefined;
	const showEmptyProperties =
		! isLayoutEditingEnabled && visiblePropertyCount === 0;

	return {
		propertyFieldsForDisplay,
		layoutReorderHandler,
		layoutVisibilityHandler,
		showEmptyProperties,
		canEditLayout,
		isLayoutEditingEnabled,
		saveError,
		visiblePropertyCount,
		hasLayoutProperties: layoutPropertyFields.length > 0,
	};
}
