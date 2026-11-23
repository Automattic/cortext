import { __ } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';
import { useEffect } from '@wordpress/element';

import DocumentIcon from './DocumentIcon';
import RowProperties from './RowProperties';
import { CollectionFieldsSnapshotProvider } from './CollectionFieldsContext';
import { SYSTEM_FIELD_ICON_IDS } from './fields/systemFieldIconIds';
import useCollectionFields from '../hooks/useCollectionFields';
import useDetailLayoutEditing from '../hooks/useDetailLayoutEditing';

import './CollectionPropertyGroup.scss';

// Header shown above a collection's property group when a row belongs to more
// than one collection, so each group is clearly attributed. The
// source collection (the one the row was opened from) reuses the same header
// with the `--source` modifier for emphasis.
export function CollectionGroupHeader( { collection } ) {
	if ( ! collection ) {
		return null;
	}
	return (
		<div className="cortext-property-group__header">
			{ collection.icon ? (
				<DocumentIcon icon={ collection.icon } size={ 20 } />
			) : null }
			<span className="cortext-property-group__title">
				{ collection.title }
			</span>
		</div>
	);
}

// Renders one non-source collection's properties for a multi-collection row.
// Each instance owns its own `useCollectionFields` + `useDetailLayoutEditing`,
// so the wrapper can map over a variable number of memberships without breaking
// the rules of hooks, and each collection's detail layout can be reordered and
// hidden independently while sharing the single `isLayoutEditing` toggle.
// `onVisibleCount` reports this group's visible field count so the block's
// collapse summary can total every collection, not just the source.
export default function AdditionalCollectionProperties( {
	collection,
	rowId,
	row,
	isLayoutEditing = false,
	onVisibleCount,
	renderProperties = true,
	includeSystemFields = false,
	isCollectionSaveLocked,
	isSaveLocked = false,
	registerPendingSaveFlusher,
} ) {
	const { detailFields, allDetailFields, detailLayoutEntries, isResolving } =
		useCollectionFields( collection.id );
	const fields = Array.isArray( detailFields ) ? detailFields : [];
	const snapshotFields = Array.isArray( allDetailFields )
		? allDetailFields
		: fields;

	const {
		propertyFieldsForDisplay,
		layoutReorderHandler,
		layoutVisibilityHandler,
		showEmptyProperties,
		isLayoutEditingEnabled,
		saveError,
		visiblePropertyCount,
		hasLayoutProperties,
	} = useDetailLayoutEditing( {
		collectionId: collection.id,
		fields,
		allFields: snapshotFields,
		detailLayoutEntries,
		rowId,
		isLayoutEditing,
		excludedFieldIds: includeSystemFields
			? undefined
			: SYSTEM_FIELD_ICON_IDS,
	} );

	useEffect( () => {
		if ( isResolving ) {
			return;
		}
		onVisibleCount?.( collection.id, visiblePropertyCount );
	}, [ collection.id, isResolving, onVisibleCount, visiblePropertyCount ] );

	// The count-only instance stays mounted while the whole properties block is
	// collapsed. This resolves the collection schema without painting an
	// interactive group, so the collapsed summary does not depend on the group
	// having been expanded before.
	if ( isResolving || ! renderProperties || ! hasLayoutProperties ) {
		return null;
	}

	return (
		<div className="cortext-property-group">
			<CollectionGroupHeader collection={ collection } />
			{ saveError ? (
				<Notice status="error" isDismissible={ false }>
					{ saveError }
				</Notice>
			) : null }
			<CollectionFieldsSnapshotProvider fields={ snapshotFields }>
				<RowProperties
					collectionId={ collection.id }
					fields={ propertyFieldsForDisplay }
					isLayoutEditing={ isLayoutEditingEnabled }
					isCollectionSaveLocked={ isCollectionSaveLocked }
					isSaveLocked={ isSaveLocked }
					onLayoutReorder={ layoutReorderHandler }
					onLayoutVisibilityToggle={ layoutVisibilityHandler }
					rowId={ rowId }
					row={ row }
					registerPendingSaveFlusher={ registerPendingSaveFlusher }
				/>
			</CollectionFieldsSnapshotProvider>
			{ showEmptyProperties ? (
				<p className="cortext-document-properties__empty">
					{ __( 'No properties are visible.', 'cortext' ) }
				</p>
			) : null }
		</div>
	);
}
