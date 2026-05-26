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
import { check, closeSmall, pencil, seen, unseen } from '@wordpress/icons';

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
		onToggleVisible,
	} = ctx ?? {};
	const isVisible = contextIsVisible !== false;
	const [ isEditingLayout, setIsEditingLayout ] = useState( false );
	const [ draftEntries, setDraftEntries ] = useState( null );
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
						name: 'crtxt_collection',
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
						'crtxt_collection',
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
		if ( ! isEditingLayout ) {
			setDraftEntries( null );
		}
	}, [ isEditingLayout ] );
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
		const entries = optimisticEntries ?? currentEntries;
		rememberPropertiesHeight();
		setOptimisticEntries( null );
		setDraftEntries( entries );
		setSaveError( null );
		setIsEditingLayout( true );
	}, [ currentEntries, optimisticEntries, rememberPropertiesHeight ] );
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
		startEditingLayout();
	}, [
		canEditLayout,
		isResolving,
		isVisible,
		layoutEditRequest,
		onToggleVisible,
		startEditingLayout,
	] );
	const cancelEditingLayout = useCallback( () => {
		setDraftEntries( null );
		setSaveError( null );
		setIsEditingLayout( false );
	}, [] );
	const handleInlineLayoutReorder = useCallback(
		async ( activeField, overField ) => {
			if ( ! collectionId ) {
				return;
			}
			const baseEntries = optimisticEntries ?? currentEntries;
			const nextEntries = reorderVisibleDetailEntries(
				baseEntries,
				activeField,
				overField
			);
			if ( nextEntries === baseEntries ) {
				return;
			}
			setOptimisticEntries( nextEntries );
			setSaveError( null );
			try {
				await saveEntityRecord(
					'postType',
					'crtxt_collection',
					{
						id: collectionId,
						meta: {
							detail_layout:
								detailLayoutMetaFromEntries( nextEntries ),
						},
					},
					{ throwOnError: true }
				);
				setOptimisticEntries( null );
			} catch ( error ) {
				setOptimisticEntries( null );
				setSaveError(
					error?.message ??
						__( 'Could not save the row detail layout.', 'cortext' )
				);
			}
		},
		[ collectionId, currentEntries, optimisticEntries, saveEntityRecord ]
	);
	const saveLayout = useCallback( async () => {
		if ( ! collectionId ) {
			return;
		}
		setSaveError( null );
		try {
			await saveEntityRecord(
				'postType',
				'crtxt_collection',
				{
					id: collectionId,
					meta: {
						detail_layout: detailLayoutMetaFromEntries(
							draftEntries ?? currentEntries
						),
					},
				},
				{ throwOnError: true }
			);
			setIsEditingLayout( false );
		} catch ( error ) {
			setSaveError(
				error?.message ??
					__( 'Could not save the row detail layout.', 'cortext' )
			);
		}
	}, [ collectionId, currentEntries, draftEntries, saveEntityRecord ] );
	const inlineLayoutFields = useMemo(
		() =>
			optimisticEntries
				? detailFieldsFromEntries(
						layoutFields,
						optimisticEntries ?? currentEntries
				  )
				: visibleFields,
		[ currentEntries, layoutFields, optimisticEntries, visibleFields ]
	);
	const draftLayoutEntries = draftEntries ?? currentEntries;
	const draftLayoutFields = useMemo( () => {
		const fieldsById = new Map(
			layoutFields.map( ( field ) => [ field.id, field ] )
		);
		return entriesWithHiddenLast( draftLayoutEntries )
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
	}, [ draftLayoutEntries, layoutFields ] );
	const handleDraftLayoutReorder = useCallback(
		( activeField, overField ) => {
			const from = draftLayoutEntries.findIndex(
				( entry ) => entry.field === activeField
			);
			const isHiddenGroupDrop =
				overField === HIDDEN_PROPERTIES_DROP_TARGET;
			const to = isHiddenGroupDrop
				? draftLayoutEntries.findIndex(
						( entry ) => entry.visible === false
				  )
				: draftLayoutEntries.findIndex(
						( entry ) => entry.field === overField
				  );
			if (
				from < 0 ||
				to < 0 ||
				( from === to && ! isHiddenGroupDrop )
			) {
				return;
			}
			const shouldHideActive =
				isHiddenGroupDrop ||
				( draftLayoutEntries[ from ]?.visible !== false &&
					draftLayoutEntries[ to ]?.visible === false );
			const shouldShowActive =
				! isHiddenGroupDrop &&
				draftLayoutEntries[ from ]?.visible === false &&
				draftLayoutEntries[ to ]?.visible !== false;
			const nextEntries = [ ...draftLayoutEntries ];
			const [ moved ] = nextEntries.splice( from, 1 );
			let nextMoved = moved;
			if ( shouldHideActive ) {
				nextMoved = { ...moved, visible: false };
			} else if ( shouldShowActive ) {
				nextMoved = { ...moved, visible: true };
			}
			const insertAt = isHiddenGroupDrop && from < to ? to - 1 : to;
			nextEntries.splice( insertAt, 0, nextMoved );
			setDraftEntries( nextEntries );
		},
		[ draftLayoutEntries ]
	);
	const handleDraftLayoutVisibilityToggle = useCallback(
		( fieldId ) => {
			setDraftEntries(
				draftLayoutEntries.map( ( entry ) =>
					entry.field === fieldId
						? { ...entry, visible: entry.visible === false }
						: entry
				)
			);
		},
		[ draftLayoutEntries ]
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
		? draftLayoutFields
		: inlineLayoutFields;
	let layoutReorderHandler;
	if ( isEditingLayout ) {
		layoutReorderHandler = handleDraftLayoutReorder;
	} else if ( canEditLayout && ! isSavingLayout ) {
		layoutReorderHandler = handleInlineLayoutReorder;
	}
	const layoutVisibilityHandler = isEditingLayout
		? handleDraftLayoutVisibilityToggle
		: undefined;
	const showEmptyProperties =
		! isEditingLayout && visiblePropertyFields.length === 0;

	if ( ! ctx || isResolving || layoutPropertyFields.length === 0 ) {
		return null;
	}

	const blockControls = (
		<BlockControls>
			{ isEditingLayout ? (
				<ToolbarGroup>
					<ToolbarButton
						icon={ check }
						label={ __( 'Save layout', 'cortext' ) }
						disabled={ isSavingLayout }
						onClick={ saveLayout }
					/>
					<ToolbarButton
						icon={ closeSmall }
						label={ __( 'Cancel layout changes', 'cortext' ) }
						disabled={ isSavingLayout }
						onClick={ cancelEditingLayout }
					/>
				</ToolbarGroup>
			) : (
				<>
					{ onToggleVisible ? (
						<ToolbarGroup>
							<ToolbarButton
								icon={ isVisible ? unseen : seen }
								label={
									isVisible
										? __( 'Hide fields', 'cortext' )
										: __( 'Show fields', 'cortext' )
								}
								onClick={ onToggleVisible }
							/>
						</ToolbarGroup>
					) : null }
					{ canEditLayout && isVisible ? (
						<ToolbarGroup>
							<ToolbarButton
								icon={ pencil }
								label={ __( 'Edit layout', 'cortext' ) }
								onClick={ startEditingLayout }
							/>
						</ToolbarGroup>
					) : null }
				</>
			) }
		</BlockControls>
	);
	const inspectorControls = (
		<InspectorControls>
			<DocumentPropertiesActions />
		</InspectorControls>
	);

	if ( ! isVisible ) {
		// Keep the hidden block selectable and give users a quick way to show
		// fields again. Match RowProperties by excluding the synthetic title
		// field from the count.
		const visibleFieldCount = visiblePropertyFields.length;
		const label = sprintf(
			/* translators: %d: number of hidden property fields. */
			_n(
				'%d property hidden',
				'%d properties hidden',
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
							{ __( 'No visible properties.', 'cortext' ) }
						</p>
					) : null }
				</div>
			</div>
		</>
	);
}
