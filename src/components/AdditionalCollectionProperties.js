import { __, _n, sprintf } from '@wordpress/i18n';
import {
	Button,
	Dropdown,
	MenuGroup,
	MenuItem,
	Notice,
} from '@wordpress/components';
import {
	chevronDownSmall,
	chevronRightSmall,
	moreHorizontal,
} from '@wordpress/icons';

import DocumentIcon from './DocumentIcon';
import { COLLECTION_ICON } from '../documents';
import RowProperties from './RowProperties';
import { CollectionFieldsSnapshotProvider } from './CollectionFieldsContext';
import { SYSTEM_FIELD_ICON_IDS } from './fields/systemFieldIconIds';
import { TITLE_FIELD_ID } from './dataViewColumns';
import useCollectionFields from '../hooks/useCollectionFields';
import useDetailLayoutEditing from '../hooks/useDetailLayoutEditing';

import './CollectionPropertyGroup.scss';

// Header of a trait's property group: the collection a row belongs to, with
// the properties that trait brings listed under it. It folds the group when
// `onToggle` is given, shows the property count while folded, and offers
// "Remove trait" when `onRemove` is given. Without a collection (the row's
// traits are still loading) it keeps its height so nothing below moves.
export function CollectionGroupHeader( {
	collection,
	count = 0,
	isCollapsed = false,
	isRemoveDisabled = false,
	onRemove,
	onToggle,
} ) {
	const label = collection ? (
		<>
			<DocumentIcon
				icon={ collection.icon || COLLECTION_ICON }
				size={ 16 }
			/>
			<span className="cortext-property-group__title">
				{ collection.title }
			</span>
			{ isCollapsed ? (
				<span
					className="cortext-property-group__count"
					aria-label={ sprintf(
						/* translators: %d: number of properties in a folded group. */
						_n( '%d property', '%d properties', count, 'cortext' ),
						count
					) }
				>
					{ count }
				</span>
			) : null }
		</>
	) : null;

	return (
		<div className="cortext-property-group__header">
			{ onToggle && collection ? (
				<Button
					className="cortext-property-group__toggle"
					icon={ isCollapsed ? chevronRightSmall : chevronDownSmall }
					aria-expanded={ ! isCollapsed }
					onClick={ onToggle }
				>
					{ label }
				</Button>
			) : (
				<span className="cortext-property-group__label">{ label }</span>
			) }
			{ onRemove && collection ? (
				<Dropdown
					className="cortext-property-group__actions"
					popoverProps={ { placement: 'bottom-end' } }
					renderToggle={ ( { isOpen, onToggle: toggleMenu } ) => (
						<Button
							className="cortext-property-group__menu"
							icon={ moreHorizontal }
							size="small"
							label={ sprintf(
								/* translators: %s: collection title. */
								__( 'Actions for %s', 'cortext' ),
								collection.title
							) }
							aria-expanded={ isOpen }
							onClick={ toggleMenu }
						/>
					) }
					renderContent={ ( { onClose } ) => (
						<MenuGroup>
							<MenuItem
								isDestructive
								disabled={ isRemoveDisabled }
								onClick={ () => {
									onClose();
									onRemove( collection );
								} }
							>
								{ __( 'Remove trait', 'cortext' ) }
							</MenuItem>
						</MenuGroup>
					) }
				/>
			) : null }
		</div>
	);
}

// How a trait group folds. Collapsing the whole block folds every group, even
// while customizing the layout; the user's own fold is suspended while
// customizing so every property stays reachable. A group without properties
// has nothing to open, so its header never toggles.
export function traitGroupFold( {
	hasProperties,
	isBlockCollapsed,
	isCollapsed,
	isLayoutEditing,
} ) {
	return {
		isFolded: isBlockCollapsed || ( ! isLayoutEditing && isCollapsed ),
		canToggle: hasProperties && ( isBlockCollapsed || ! isLayoutEditing ),
	};
}

// System properties (created, last edited) describe the document, not a
// collection, so they leave the trait groups and render in their own block
// after all of them. They still follow the owning collection's layout for
// order and visibility.
function isSystemField( field ) {
	return SYSTEM_FIELD_ICON_IDS.has( field?.id );
}

function hasTraitProperties( fields ) {
	return fields.some(
		( field ) => field.id !== TITLE_FIELD_ID && ! isSystemField( field )
	);
}

// One trait's property group: its header, then the properties it brings. The
// source group and every additional group render through here; `layout` is the
// group's `useDetailLayoutEditing` result.
export function TraitPropertyGroup( {
	className = '',
	collection,
	collectionId,
	layout,
	snapshotFields,
	rowId,
	row,
	isLayoutEditing = false,
	isBlockCollapsed = false,
	isCollapsed = false,
	onToggleCollapsed,
	onRemove,
	isRemoveDisabled = false,
	isCollectionSaveLocked,
	isSaveLocked = false,
	registerPendingSaveFlusher,
	showSaveError = true,
} ) {
	const fields = layout.propertyFieldsForDisplay.filter(
		( field ) => ! isSystemField( field )
	);
	const hasProperties = hasTraitProperties( snapshotFields );
	// A folded group keeps only its header. A collection without properties of
	// its own shows just its header, which still names the trait.
	const { isFolded, canToggle } = traitGroupFold( {
		hasProperties,
		isBlockCollapsed,
		isCollapsed,
		isLayoutEditing,
	} );
	const showProperties = hasProperties && ! isFolded;
	// While customizing, the list also carries the hidden properties.
	const count = fields.filter(
		( field ) =>
			field.id !== TITLE_FIELD_ID && field.cortextDetailVisible !== false
	).length;
	const showEmptyNotice = ! layout.isLayoutEditingEnabled && count === 0;

	return (
		<div className={ `cortext-property-group ${ className }`.trim() }>
			<CollectionGroupHeader
				collection={ collection }
				count={ count }
				isCollapsed={ hasProperties && isFolded }
				isRemoveDisabled={ isRemoveDisabled }
				onRemove={ isLayoutEditing ? undefined : onRemove }
				onToggle={
					canToggle && onToggleCollapsed
						? () => onToggleCollapsed( collectionId )
						: undefined
				}
			/>
			{ ! showProperties ? null : (
				<>
					{ showSaveError && layout.saveError ? (
						<Notice status="error" isDismissible={ false }>
							{ layout.saveError }
						</Notice>
					) : null }
					<CollectionFieldsSnapshotProvider fields={ snapshotFields }>
						<RowProperties
							collectionId={ collectionId }
							fields={ fields }
							isLayoutEditing={ layout.isLayoutEditingEnabled }
							isCollectionSaveLocked={ isCollectionSaveLocked }
							isSaveLocked={ isSaveLocked }
							onLayoutReorder={ layout.layoutReorderHandler }
							onLayoutVisibilityToggle={
								layout.layoutVisibilityHandler
							}
							rowId={ rowId }
							row={ row }
							registerPendingSaveFlusher={
								registerPendingSaveFlusher
							}
						/>
					</CollectionFieldsSnapshotProvider>
					{ showEmptyNotice ? (
						<p className="cortext-document-properties__empty">
							{ __( 'No properties are visible.', 'cortext' ) }
						</p>
					) : null }
				</>
			) }
		</div>
	);
}

// The document's system properties, after every trait group. They share the
// owning group's layout, so reordering or hiding one writes the same layout.
// The fields are read-only, so this list registers no pending saves.
export function SystemProperties( {
	collectionId,
	layout,
	snapshotFields,
	rowId,
	row,
	isBlockCollapsed = false,
	isCollectionSaveLocked,
	isSaveLocked = false,
} ) {
	const fields = layout.propertyFieldsForDisplay.filter( isSystemField );
	if ( isBlockCollapsed || fields.length === 0 ) {
		return null;
	}
	return (
		<div className="cortext-property-group cortext-property-group--system">
			<CollectionFieldsSnapshotProvider fields={ snapshotFields }>
				<RowProperties
					collectionId={ collectionId }
					fields={ fields }
					isLayoutEditing={ layout.isLayoutEditingEnabled }
					isCollectionSaveLocked={ isCollectionSaveLocked }
					isSaveLocked={ isSaveLocked }
					onLayoutReorder={ layout.layoutReorderHandler }
					onLayoutVisibilityToggle={ layout.layoutVisibilityHandler }
					rowId={ rowId }
					row={ row }
				/>
			</CollectionFieldsSnapshotProvider>
		</div>
	);
}

// Renders one non-source collection's property group for a multi-collection
// row. Each instance owns its own `useCollectionFields` +
// `useDetailLayoutEditing`, so the wrapper can map over a variable number of
// memberships without breaking the rules of hooks, and each collection's detail
// layout can be reordered and hidden independently while sharing the single
// `isLayoutEditing` toggle. The group that owns the system properties renders
// them after itself, so the block places it last; `children` go between the
// group and those properties.
export default function AdditionalCollectionProperties( {
	collection,
	rowId,
	row,
	isLayoutEditing = false,
	showGroup = true,
	isBlockCollapsed = false,
	isCollapsed = false,
	onToggleCollapsed,
	onRemove,
	isRemoveDisabled = false,
	includeSystemFields = false,
	isCollectionSaveLocked,
	isSaveLocked = false,
	registerPendingSaveFlusher,
	children,
} ) {
	const { detailFields, allDetailFields, detailLayoutEntries, isResolving } =
		useCollectionFields( collection.id );
	const fields = Array.isArray( detailFields ) ? detailFields : [];
	const snapshotFields = Array.isArray( allDetailFields )
		? allDetailFields
		: fields;

	const layout = useDetailLayoutEditing( {
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

	// The instance stays mounted while the memberships refresh, without
	// painting a group whose membership is in doubt.
	if ( isResolving || ! showGroup ) {
		return null;
	}

	return (
		<>
			<TraitPropertyGroup
				collection={ collection }
				collectionId={ collection.id }
				layout={ layout }
				snapshotFields={ snapshotFields }
				rowId={ rowId }
				row={ row }
				isLayoutEditing={ isLayoutEditing }
				isBlockCollapsed={ isBlockCollapsed }
				isCollapsed={ isCollapsed }
				onToggleCollapsed={ onToggleCollapsed }
				onRemove={ onRemove }
				isRemoveDisabled={ isRemoveDisabled }
				isCollectionSaveLocked={ isCollectionSaveLocked }
				isSaveLocked={ isSaveLocked }
				registerPendingSaveFlusher={ registerPendingSaveFlusher }
			/>
			{ children }
			{ includeSystemFields ? (
				<SystemProperties
					collectionId={ collection.id }
					layout={ layout }
					snapshotFields={ snapshotFields }
					rowId={ rowId }
					row={ row }
					isBlockCollapsed={ isBlockCollapsed }
					isCollectionSaveLocked={ isCollectionSaveLocked }
					isSaveLocked={ isSaveLocked }
				/>
			) : null }
		</>
	);
}
