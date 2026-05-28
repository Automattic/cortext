import { __, _n, sprintf } from '@wordpress/i18n';
import {
	BlockControls,
	InspectorControls,
	useBlockProps,
} from '@wordpress/block-editor';
import {
	Button,
	Notice,
	ToolbarButton,
	ToolbarGroup,
} from '@wordpress/components';
import { store as coreStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';
import { pencil, seen, unseen } from '@wordpress/icons';

import DocumentPropertiesActions from '../../components/DocumentPropertiesActions';
import RowProperties, {
	HIDDEN_PROPERTIES_DROP_TARGET,
} from '../../components/RowProperties';
import { CollectionFieldsSnapshotProvider } from '../../components/CollectionFieldsContext';
import { TITLE_FIELD_ID } from '../../components/dataViewColumns';
import { useDocumentPropertiesContext } from '../../components/DocumentPropertiesContext';
import {
	detailFieldsFromEntries,
	detailLayoutMetaFromEntries,
	reorderVisibleDetailEntries,
} from '../../hooks/detailLayout';

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

// Row documents show collection properties between the title and body. Canvas
// and RowEditor provide the fields and fallback row record; pages and rows
// without fields return null.
export default function Edit() {
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
	const [ isEditingLayout, setIsEditingLayout ] = useState( false );
	const [ optimisticEntries, setOptimisticEntries ] = useState( null );
	const [ layoutEditorMinHeight, setLayoutEditorMinHeight ] =
		useState( null );
	const [ saveError, setSaveError ] = useState( null );
	const propertiesContentRef = useRef( null );
	const lastLayoutEditRequestRef = useRef( 0 );
	const { saveEntityRecord } = useDispatch( coreStore );
	// RowProperties still expects the row-detail ancestor used by its nested
	// SCSS rules. The collapsed stub does not render RowProperties, so it can
	// use its smaller wrapper.
	const blockProps = useBlockProps( {
		className: isVisible
			? 'cortext-document-properties cortext-row-detail'
			: 'cortext-document-properties cortext-document-properties--collapsed',
	} );
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
	const visiblePropertyFields = useMemo(
		() => visibleFields.filter( ( field ) => field.id !== TITLE_FIELD_ID ),
		[ visibleFields ]
	);
	const layoutPropertyFields = useMemo(
		() => layoutFields.filter( ( field ) => field.id !== TITLE_FIELD_ID ),
		[ layoutFields ]
	);
	const currentEntries = useMemo(
		() =>
			Array.isArray( detailLayoutEntries )
				? detailLayoutEntries
				: layoutPropertyFields.map( ( field ) => ( {
						field: field.id,
						visible: true,
				  } ) ),
		[ detailLayoutEntries, layoutPropertyFields ]
	);
	useEffect( () => {
		setOptimisticEntries( null );
	}, [ collectionId, rowId ] );
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
		setSaveError( null );
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
			! layoutEditRequest ||
			lastLayoutEditRequestRef.current === layoutEditRequest ||
			isResolving ||
			! canEditLayout
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
		canEditLayout,
		isResolving,
		isEditingLayout,
		isVisible,
		layoutEditRequest,
		onToggleVisible,
		startEditingLayout,
		stopEditingLayout,
	] );
	const saveLayoutEntries = useCallback(
		async ( nextEntries ) => {
			if ( ! collectionId ) {
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
						__( 'Could not save the property layout.', 'cortext' )
				);
			}
		},
		[ collectionId, optimisticEntries, saveEntityRecord ]
	);
	const handleInlineLayoutReorder = useCallback(
		( activeField, overField ) => {
			if ( isSavingLayout ) {
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
		[ currentEntries, isSavingLayout, optimisticEntries, saveLayoutEntries ]
	);
	const layoutEntries = useMemo(
		() => reconcileOptimisticEntries( optimisticEntries, currentEntries ),
		[ currentEntries, optimisticEntries ]
	);
	const inlineLayoutFields = useMemo(
		() =>
			optimisticEntries
				? detailFieldsFromEntries( layoutFields, layoutEntries )
				: visibleFields,
		[ layoutEntries, layoutFields, optimisticEntries, visibleFields ]
	);
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
			.filter( Boolean );
	}, [ layoutEntries, layoutFields ] );
	const handleLayoutEditReorder = useCallback(
		( activeField, overField ) => {
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
		[ layoutEntries, saveLayoutEntries ]
	);
	const handleLayoutVisibilityToggle = useCallback(
		( fieldId ) => {
			const nextEntries = layoutEntries.map( ( entry ) =>
				entry.field === fieldId
					? { ...entry, visible: entry.visible === false }
					: entry
			);
			saveLayoutEntries( nextEntries );
		},
		[ layoutEntries, saveLayoutEntries ]
	);
	useLayoutEffect( () => {
		if ( ! isEditingLayout ) {
			rememberPropertiesHeight();
		}
	}, [
		inlineLayoutFields,
		isEditingLayout,
		rememberPropertiesHeight,
		visiblePropertyFields.length,
	] );
	const propertyFieldsForDisplay = isEditingLayout
		? layoutEditingFields
		: inlineLayoutFields;
	let layoutReorderHandler;
	if ( isEditingLayout ) {
		layoutReorderHandler = handleLayoutEditReorder;
	} else if ( canEditLayout ) {
		layoutReorderHandler = handleInlineLayoutReorder;
	}
	const layoutVisibilityHandler = isEditingLayout
		? handleLayoutVisibilityToggle
		: undefined;
	const showEmptyProperties =
		! isEditingLayout && visiblePropertyFields.length === 0;

	if ( ! ctx || isResolving || layoutPropertyFields.length === 0 ) {
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
			{ canEditLayout && isVisible ? (
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

	if ( ! isVisible ) {
		// Keep the hidden block selectable and give users a quick way to show
		// properties again. Match RowProperties by excluding the synthetic
		// title property from the count.
		const visibleFieldCount = visiblePropertyFields.length;
		const label = sprintf(
			/* translators: %d: number of collapsed properties. */
			_n(
				'%d property collapsed',
				'%d properties collapsed',
				visibleFieldCount,
				'cortext'
			),
			visibleFieldCount
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
				</div>
			</>
		);
	}

	return (
		<>
			{ blockControls }
			{ inspectorControls }
			<div { ...blockProps }>
				{ saveError ? (
					<Notice status="error" isDismissible={ false }>
						{ saveError }
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
					{ collectionId ? (
						<CollectionFieldsSnapshotProvider
							fields={ layoutFields }
						>
							<RowProperties
								collectionId={ collectionId }
								fields={ propertyFieldsForDisplay }
								isLayoutEditing={ isEditingLayout }
								onLayoutReorder={ layoutReorderHandler }
								onLayoutVisibilityToggle={
									layoutVisibilityHandler
								}
								rowId={ rowId }
								row={ fallbackRecord }
							/>
						</CollectionFieldsSnapshotProvider>
					) : (
						<RowProperties
							fields={ propertyFieldsForDisplay }
							isLayoutEditing={ isEditingLayout }
							onLayoutReorder={ layoutReorderHandler }
							onLayoutVisibilityToggle={ layoutVisibilityHandler }
							rowId={ rowId }
							row={ fallbackRecord }
						/>
					) }
					{ showEmptyProperties ? (
						<p className="cortext-document-properties__empty">
							{ __( 'No properties are visible.', 'cortext' ) }
						</p>
					) : null }
				</div>
			</div>
		</>
	);
}
