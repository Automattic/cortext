import { __, _n, sprintf } from '@wordpress/i18n';
import {
	BlockControls,
	InspectorControls,
	store as blockEditorStore,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	Button,
	Notice,
	ToolbarButton,
	ToolbarGroup,
} from '@wordpress/components';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { pencil, seen, unseen } from '@wordpress/icons';

import DocumentPropertiesActions from '../../components/DocumentPropertiesActions';
import RowProperties from '../../components/RowProperties';
import AdditionalCollectionProperties, {
	CollectionGroupHeader,
} from '../../components/AdditionalCollectionProperties';
import TraitControl from '../../components/AddTraitControl';
import { CollectionFieldsSnapshotProvider } from '../../components/CollectionFieldsContext';
import { useDocumentPropertiesContext } from '../../components/DocumentPropertiesContext';
import { visibleTraits } from '../../documents/traits';
import useDocumentTraits from '../../hooks/useDocumentTraits';
import useDetailLayoutEditing from '../../hooks/useDetailLayoutEditing';

// Row documents show collection properties between the title and body. Canvas
// and RowEditor provide the source collection's fields and the fallback row
// record; a row's other collections resolve their own fields. Pages
// and rows without fields return null.
export default function Edit( { clientId, isSelected } ) {
	const ctx = useDocumentPropertiesContext();
	const {
		collectionId = null,
		rowId = null,
		fields = [],
		allFields,
		detailLayoutEntries,
		fallbackRecord,
		isResolving = false,
		isVisible: contextIsVisible = true,
		layoutEditRequest = 0,
		onLayoutEditingChange,
		onToggleVisible,
	} = ctx ?? {};
	const isVisible = contextIsVisible !== false;

	// All the collections this row belongs to. `collectionId` from
	// context is the source collection (the one the row was opened from); the
	// rest render as additional groups below it.
	const {
		collections: memberships,
		isResolving: membershipsResolving,
		isInitialLoad: membershipsFirstLoad = false,
		isUnknown: membershipsUnknown = false,
		error: membershipsError = null,
		refresh: refreshTraits,
	} = useDocumentTraits( rowId );
	const membershipsAreActionable =
		! membershipsResolving && ! membershipsUnknown;
	// Archived and trashed rows are read-only, their traits included.
	const isRowRetired = useSelect(
		( select ) =>
			[ 'trash', 'crtxt_archived' ].includes(
				select( editorStore ).getCurrentPostAttribute( 'status' )
			),
		[]
	);
	// Only the visible memberships render property groups. `memberships` keeps
	// the rest so a PUT does not drop them.
	const visibleMemberships = useMemo(
		() => visibleTraits( memberships ),
		[ memberships ]
	);
	const currentMembershipIds = useMemo(
		() =>
			visibleMemberships
				.map( ( collection ) => Number( collection.id ) )
				.filter( ( id ) => id > 0 ),
		[ visibleMemberships ]
	);
	const canEditAnyCurrentLayout = useSelect(
		( select ) =>
			membershipsAreActionable &&
			currentMembershipIds.some(
				( id ) =>
					select( coreStore ).canUser( 'update', {
						kind: 'postType',
						name: 'crtxt_document',
						id,
					} ) === true
			),
		[ currentMembershipIds, membershipsAreActionable ]
	);
	const additionalCollections = useMemo(
		() =>
			visibleMemberships.filter(
				( collection ) => collection.id !== collectionId
			),
		[ visibleMemberships, collectionId ]
	);
	const sourceCollection = useMemo(
		() =>
			visibleMemberships.find(
				( collection ) => collection.id === collectionId
			) ?? null,
		[ visibleMemberships, collectionId ]
	);
	const isMultiMembership = visibleMemberships.length > 1;
	// Once memberships have loaded, if the source collection is no longer one of
	// the visible ones (the user just removed the collection they opened the row
	// from, or that collection was archived or trashed), drop the now-stale source
	// group. Also hide it while refreshing: those fields and layout handlers
	// target a membership whose continued existence is not yet known. The first
	// load has nothing stale to hide, because the row was just opened from the
	// source collection, so its group shows while the memberships arrive.
	const sourceInactive =
		membershipsAreActionable &&
		! visibleMemberships.some(
			( collection ) => collection.id === collectionId
		);
	const showSourceGroup =
		membershipsFirstLoad ||
		( membershipsAreActionable && ! sourceInactive );
	// System properties describe the row rather than a collection. The source
	// group normally owns them; when it does not render, exactly one surviving
	// group takes ownership so they neither disappear nor repeat.
	const systemFieldsOwnerId = sourceInactive
		? additionalCollections[ 0 ]?.id ?? null
		: null;

	const [ isEditingLayout, setIsEditingLayout ] = useState( false );
	const [ layoutEditorMinHeight, setLayoutEditorMinHeight ] =
		useState( null );
	// Visible-field counts reported by each additional collection group, so the
	// collapse summary totals every collection rather than just the source. They
	// persist while collapsed (the groups unmount), keyed by collection id.
	const [ additionalCounts, setAdditionalCounts ] = useState( {} );
	const [ lockedCollectionIds, setLockedCollectionIds ] = useState(
		() => new Set()
	);
	const propertiesContentRef = useRef( null );
	const lastLayoutEditRequestRef = useRef( 0 );
	const pendingSaveFlushersRef = useRef( new Map() );
	const orphanedPendingSavesRef = useRef( new Map() );
	const pendingSaveRegistryRevisionRef = useRef( 0 );
	const collectionSaveLockTokensRef = useRef( new Map() );
	const rememberOrphanedPendingSave = useCallback(
		( targetCollectionId, pendingSave ) => {
			if ( ! pendingSave ) {
				return;
			}
			const normalizedId = Number( targetCollectionId );
			if ( normalizedId < 1 ) {
				return;
			}
			// Convert rejection into data immediately. The component that started
			// this save is gone, so nobody else can catch it before a later
			// membership barrier observes it.
			const tracked = Promise.resolve( pendingSave ).then(
				() => ( { status: 'fulfilled' } ),
				( reason ) => ( { status: 'rejected', reason } )
			);
			let saves = orphanedPendingSavesRef.current.get( normalizedId );
			if ( ! saves ) {
				saves = new Set();
				orphanedPendingSavesRef.current.set( normalizedId, saves );
			}
			saves.add( tracked );
			pendingSaveRegistryRevisionRef.current += 1;
			tracked.then( ( result ) => {
				// Successful saves need no later barrier once settled. Rejections
				// remain until beforeRemoveCollection reports them to the user.
				if ( result.status !== 'fulfilled' ) {
					return;
				}
				saves.delete( tracked );
				if (
					saves.size === 0 &&
					orphanedPendingSavesRef.current.get( normalizedId ) ===
						saves
				) {
					orphanedPendingSavesRef.current.delete( normalizedId );
				}
			} );
		},
		[]
	);
	const registerPendingSaveFlusher = useCallback(
		( targetCollectionId, flush ) => {
			const normalizedId = Number( targetCollectionId );
			if ( normalizedId < 1 || typeof flush !== 'function' ) {
				return () => {};
			}
			pendingSaveFlushersRef.current.set( normalizedId, flush );
			pendingSaveRegistryRevisionRef.current += 1;
			return ( orphanedPendingSave = null ) => {
				if (
					pendingSaveFlushersRef.current.get( normalizedId ) === flush
				) {
					pendingSaveFlushersRef.current.delete( normalizedId );
					pendingSaveRegistryRevisionRef.current += 1;
				}
				rememberOrphanedPendingSave(
					normalizedId,
					orphanedPendingSave
				);
			};
		},
		[ rememberOrphanedPendingSave ]
	);
	const flushPendingCollectionSaves = useCallback(
		async ( targetCollectionId ) => {
			const normalizedId = Number( targetCollectionId );

			// Orphaned groups are always drained first, then the current group is
			// recaptured and flushed. This ordering matters: the current group can
			// receive edits while an old collapsed group's request is in flight.
			while ( true ) {
				while ( true ) {
					const saves =
						orphanedPendingSavesRef.current.get( normalizedId );
					const orphaned = saves ? Array.from( saves ) : [];
					if ( orphaned.length === 0 ) {
						break;
					}
					orphaned.forEach( ( pendingSave ) =>
						saves.delete( pendingSave )
					);
					const orphanedResults = await Promise.all( orphaned );
					const failedOrphan = orphanedResults.find(
						( result ) => result.status === 'rejected'
					);
					if ( failedOrphan ) {
						throw failedOrphan.reason;
					}
				}

				const revisionBeforeFlush =
					pendingSaveRegistryRevisionRef.current;
				const currentFlusher =
					pendingSaveFlushersRef.current.get( normalizedId );
				if ( currentFlusher ) {
					await currentFlusher();
				}

				const currentAfterFlush =
					pendingSaveFlushersRef.current.get( normalizedId );
				const newOrphans =
					orphanedPendingSavesRef.current.get( normalizedId );
				if (
					( newOrphans?.size ?? 0 ) === 0 &&
					pendingSaveRegistryRevisionRef.current ===
						revisionBeforeFlush &&
					currentAfterFlush === currentFlusher
				) {
					if ( newOrphans ) {
						orphanedPendingSavesRef.current.delete( normalizedId );
					}
					return true;
				}
			}
		},
		[]
	);
	const isCollectionSaveLocked = useCallback(
		( targetCollectionId ) =>
			collectionSaveLockTokensRef.current.has(
				Number( targetCollectionId )
			),
		[]
	);
	const prepareCollectionRemoval = useCallback(
		( targetCollectionId ) => {
			const normalizedId = Number( targetCollectionId );
			if ( normalizedId < 1 ) {
				return Promise.resolve( () => {} );
			}
			const token = Symbol( `collection-save-lock:${ normalizedId }` );
			collectionSaveLockTokensRef.current.set( normalizedId, token );
			setLockedCollectionIds( ( current ) => {
				if ( current.has( normalizedId ) ) {
					return current;
				}
				const next = new Set( current );
				next.add( normalizedId );
				return next;
			} );

			let released = false;
			const release = () => {
				if (
					released ||
					collectionSaveLockTokensRef.current.get( normalizedId ) !==
						token
				) {
					return;
				}
				released = true;
				collectionSaveLockTokensRef.current.delete( normalizedId );
				setLockedCollectionIds( ( current ) => {
					if ( ! current.has( normalizedId ) ) {
						return current;
					}
					const next = new Set( current );
					next.delete( normalizedId );
					return next;
				} );
			};

			return flushPendingCollectionSaves( normalizedId ).then(
				() => release,
				( error ) => {
					release();
					throw error;
				}
			);
		},
		[ flushPendingCollectionSaves ]
	);

	const blockProps = useBlockProps( {
		className: isVisible
			? 'cortext-document-properties cortext-row-detail'
			: 'cortext-document-properties cortext-document-properties--collapsed',
	} );

	// The source collection's detail-layout editing. Additional collections own
	// theirs inside `AdditionalCollectionProperties`; all share `isEditingLayout`.
	const source = useDetailLayoutEditing( {
		collectionId,
		fields,
		allFields,
		detailLayoutEntries,
		rowId,
		isLayoutEditing: isEditingLayout,
	} );
	const sourceBaseFields = Array.isArray( fields ) ? fields : [];
	const sourceSnapshotFields = Array.isArray( allFields )
		? allFields
		: sourceBaseFields;

	useEffect( () => {
		onLayoutEditingChange?.( isEditingLayout );
	}, [ isEditingLayout, onLayoutEditingChange ] );

	const rememberPropertiesHeight = useCallback( () => {
		const height =
			propertiesContentRef.current?.getBoundingClientRect?.().height;
		if ( ! height ) {
			return;
		}
		const nextHeight = Math.ceil( height );
		setLayoutEditorMinHeight( ( current ) =>
			current === nextHeight ? current : nextHeight
		);
	}, [] );
	const startEditingLayout = useCallback( () => {
		rememberPropertiesHeight();
		setIsEditingLayout( true );
	}, [ rememberPropertiesHeight ] );
	const stopEditingLayout = useCallback( () => {
		setIsEditingLayout( false );
	}, [] );
	const toggleEditingLayout = useCallback( () => {
		if ( isEditingLayout ) {
			stopEditingLayout();
			return;
		}
		startEditingLayout();
	}, [ isEditingLayout, startEditingLayout, stopEditingLayout ] );
	useEffect( () => {
		if (
			( ! membershipsAreActionable || ! canEditAnyCurrentLayout ) &&
			isEditingLayout
		) {
			stopEditingLayout();
		}
	}, [
		canEditAnyCurrentLayout,
		isEditingLayout,
		membershipsAreActionable,
		stopEditingLayout,
	] );
	useEffect( () => {
		if (
			! layoutEditRequest ||
			lastLayoutEditRequestRef.current === layoutEditRequest ||
			isResolving ||
			! membershipsAreActionable ||
			! canEditAnyCurrentLayout
		) {
			return;
		}
		lastLayoutEditRequestRef.current = layoutEditRequest;
		if ( ! isVisible && onToggleVisible ) {
			onToggleVisible();
		}
		if ( isEditingLayout ) {
			stopEditingLayout();
			return;
		}
		startEditingLayout();
	}, [
		canEditAnyCurrentLayout,
		isResolving,
		membershipsAreActionable,
		isEditingLayout,
		isVisible,
		layoutEditRequest,
		onToggleVisible,
		startEditingLayout,
		stopEditingLayout,
	] );
	const reportAdditionalCount = useCallback(
		( collectionRecordId, count ) => {
			setAdditionalCounts( ( current ) =>
				current[ collectionRecordId ] === count
					? current
					: { ...current, [ collectionRecordId ]: count }
			);
		},
		[]
	);
	useLayoutEffect( () => {
		if ( ! isEditingLayout ) {
			rememberPropertiesHeight();
		}
	}, [
		isEditingLayout,
		rememberPropertiesHeight,
		source.propertyFieldsForDisplay,
	] );

	// The traits row keeps its place during the first load, without chips or
	// controls, so the properties below do not move when the traits arrive.
	const showTraitControl =
		Boolean( rowId ) &&
		( membershipsFirstLoad ||
			( membershipsAreActionable && memberships.length > 0 ) );
	const canRenderTraitShell =
		showTraitControl || ( rowId && membershipsError );

	// tech-debt.md#td-gutenberg-header-boundary: every document carries this
	// block, and with nothing to show it has no element to focus. Gutenberg
	// still selects it as the block before the first body block, for example
	// after removing that block or on Backspace at its start, so hand the
	// selection to the block before it, the title.
	const rendersNothing =
		! ctx ||
		isResolving ||
		( ! source.hasLayoutProperties && ! canRenderTraitShell );
	const previousClientId = useSelect(
		( select ) =>
			select( blockEditorStore ).getPreviousBlockClientId( clientId ),
		[ clientId ]
	);
	const { selectBlock } = useDispatch( blockEditorStore );
	useLayoutEffect( () => {
		if ( isSelected && rendersNothing && previousClientId ) {
			selectBlock( previousClientId, -1 );
		}
	}, [ isSelected, previousClientId, rendersNothing, selectBlock ] );

	if ( rendersNothing ) {
		return null;
	}

	const blockControls = (
		<BlockControls>
			{ onToggleVisible ? (
				<ToolbarGroup>
					<ToolbarButton
						icon={ isVisible ? unseen : seen }
						label={
							isVisible
								? __( 'Collapse properties', 'cortext' )
								: __( 'Expand properties', 'cortext' )
						}
						onClick={ onToggleVisible }
					/>
				</ToolbarGroup>
			) : null }
			{ canEditAnyCurrentLayout &&
			isVisible &&
			membershipsAreActionable ? (
				<ToolbarGroup>
					<ToolbarButton
						icon={ pencil }
						label={
							isEditingLayout
								? __( 'Done customizing', 'cortext' )
								: __( 'Customize properties', 'cortext' )
						}
						isPressed={ isEditingLayout }
						onClick={ toggleEditingLayout }
					/>
				</ToolbarGroup>
			) : null }
		</BlockControls>
	);
	const inspectorControls = (
		<InspectorControls>
			<DocumentPropertiesActions />
		</InspectorControls>
	);

	const additionalVisibleTotal = additionalCollections.reduce(
		( sum, collection ) => sum + ( additionalCounts[ collection.id ] ?? 0 ),
		0
	);
	const totalVisibleCount =
		( showSourceGroup ? source.visiblePropertyCount : 0 ) +
		additionalVisibleTotal;
	const additionalPropertyGroups = additionalCollections.map(
		( collection ) => (
			<AdditionalCollectionProperties
				key={ collection.id }
				collection={ collection }
				rowId={ rowId }
				row={ fallbackRecord }
				isLayoutEditing={ isEditingLayout }
				onVisibleCount={ reportAdditionalCount }
				renderProperties={ isVisible && membershipsAreActionable }
				includeSystemFields={ collection.id === systemFieldsOwnerId }
				isCollectionSaveLocked={ isCollectionSaveLocked }
				isSaveLocked={ lockedCollectionIds.has(
					Number( collection.id )
				) }
				registerPendingSaveFlusher={ registerPendingSaveFlusher }
			/>
		)
	);

	if ( ! isVisible ) {
		// Keep the hidden block selectable and give users a quick way to show
		// properties again. The count totals every collection the row belongs to.
		const label = sprintf(
			/* translators: %d: number of collapsed fields. */
			_n(
				'%d property collapsed',
				'%d properties collapsed',
				totalVisibleCount,
				'cortext'
			),
			totalVisibleCount
		);
		return (
			<>
				{ blockControls }
				{ inspectorControls }
				<div { ...blockProps }>
					<Button
						className="cortext-document-properties__collapsed-toggle"
						variant="tertiary"
						icon={ seen }
						onClick={ onToggleVisible }
					>
						{ label }
					</Button>
					{ additionalPropertyGroups }
				</div>
			</>
		);
	}

	const sourceProperties = collectionId ? (
		<CollectionFieldsSnapshotProvider fields={ sourceSnapshotFields }>
			<RowProperties
				collectionId={ collectionId }
				fields={ source.propertyFieldsForDisplay }
				isLayoutEditing={ source.isLayoutEditingEnabled }
				isCollectionSaveLocked={ isCollectionSaveLocked }
				isSaveLocked={ lockedCollectionIds.has(
					Number( collectionId )
				) }
				onLayoutReorder={ source.layoutReorderHandler }
				onLayoutVisibilityToggle={ source.layoutVisibilityHandler }
				rowId={ rowId }
				row={ fallbackRecord }
				registerPendingSaveFlusher={ registerPendingSaveFlusher }
			/>
		</CollectionFieldsSnapshotProvider>
	) : (
		<RowProperties
			fields={ source.propertyFieldsForDisplay }
			isLayoutEditing={ source.isLayoutEditingEnabled }
			isCollectionSaveLocked={ isCollectionSaveLocked }
			onLayoutReorder={ source.layoutReorderHandler }
			onLayoutVisibilityToggle={ source.layoutVisibilityHandler }
			rowId={ rowId }
			row={ fallbackRecord }
			registerPendingSaveFlusher={ registerPendingSaveFlusher }
		/>
	);

	// When the row belongs to several collections, label the source group with a
	// header too (including while editing), so every editable group reads as its
	// own collection.
	let sourceGroup = null;
	if ( showSourceGroup ) {
		sourceGroup = isMultiMembership ? (
			<div className="cortext-property-group cortext-property-group--source">
				<CollectionGroupHeader collection={ sourceCollection } />
				{ sourceProperties }
			</div>
		) : (
			sourceProperties
		);
	}

	return (
		<>
			{ blockControls }
			{ inspectorControls }
			<div { ...blockProps }>
				{ membershipsError ? (
					<Notice
						status="error"
						isDismissible={ false }
						actions={ [
							{
								label: __( 'Retry', 'cortext' ),
								onClick: refreshTraits,
							},
						] }
					>
						{ __(
							"Couldn't load the collections for this item.",
							'cortext'
						) }
					</Notice>
				) : null }
				{ showSourceGroup && source.saveError ? (
					<Notice status="error" isDismissible={ false }>
						{ source.saveError }
					</Notice>
				) : null }
				<div
					ref={ propertiesContentRef }
					className={
						isEditingLayout
							? 'cortext-document-properties__layout-editor-wrap'
							: undefined
					}
					style={
						isEditingLayout && layoutEditorMinHeight
							? { minHeight: layoutEditorMinHeight }
							: undefined
					}
				>
					{ showTraitControl && ! isEditingLayout ? (
						<TraitControl
							beforeRemoveCollection={ prepareCollectionRemoval }
							documentId={ rowId }
							collections={ memberships }
							isReadOnly={ isRowRetired || membershipsFirstLoad }
							onChange={ refreshTraits }
						/>
					) : null }
					{ sourceGroup }
					{ showSourceGroup && source.showEmptyProperties ? (
						<p className="cortext-document-properties__empty">
							{ __( 'No properties are visible.', 'cortext' ) }
						</p>
					) : null }
					{ additionalPropertyGroups }
				</div>
			</div>
		</>
	);
}
