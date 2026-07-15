import {
	BlockInspector,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { createBlock } from '@wordpress/blocks';
import {
	Button,
	Disabled,
	Fill,
	Notice,
	PanelBody,
	privateApis as componentsPrivateApis,
	Slot,
} from '@wordpress/components';
import {
	useEntityProp,
	useEntityRecord,
	useEntityRecords,
	store as coreStore,
} from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import {
	useCallback,
	useContext,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	closeSmall,
	home as homeIcon,
	starEmpty,
	starFilled,
	trash,
} from '@wordpress/icons';
import { store as interfaceStore } from '@wordpress/interface';
import apiFetch from '@wordpress/api-fetch';

import CanvasOwnerInspector, {
	useIsCanvasOwnerSelected,
} from './CanvasOwnerInspector';
import './DocumentInspectorSidebar.scss';

import DocumentPropertiesActions from './DocumentPropertiesActions';
import BacklinksPanel from './BacklinksPanel';
import MediaPicker, { MediaUploadCheck } from './MediaPicker';
import DocumentIcon from './DocumentIcon';
import DocumentIdentityControls from './DocumentIdentityControls';
import { SkeletonBlock } from './Skeleton';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { filterFavoritesForTrashedPage } from './SidebarFavorites';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import { DOCUMENT_POST_TYPE, FULL_PAGE_COLLECTION_QUERY } from '../collections';
import { definesTrait } from '../documents/capabilities';
import { unlock } from '../lock-unlock';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { useFavorites } from '../hooks/useFavorites';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';

const { Tabs } = unlock( componentsPrivateApis );

export const INSPECTOR_SCOPE = 'cortext';
export const DOCUMENT_INSPECTOR = 'cortext/document-inspector';
export const BLOCK_INSPECTOR = 'cortext/block-inspector';
const INSPECTOR_SLOT = `ComplementaryArea/${ INSPECTOR_SCOPE }`;
const INSPECTOR_ANIMATION_DURATION_MS = 300;

export function isInspectorArea( area ) {
	return area === DOCUMENT_INSPECTOR || area === BLOCK_INSPECTOR;
}

export function getActiveInspectorArea( select ) {
	try {
		return select( interfaceStore ).getActiveComplementaryArea(
			INSPECTOR_SCOPE
		);
	} catch {
		return null;
	}
}

export function InspectorSidebarSlot( props ) {
	return <Slot name={ INSPECTOR_SLOT } { ...props } />;
}

function useAdjustInspectorToViewport( {
	activeArea,
	identifier,
	isActive,
	isSmall,
} ) {
	const previousIsSmall = useRef( false );
	const shouldOpenWhenNotSmall = useRef( false );
	const { enableComplementaryArea, disableComplementaryArea } =
		useDispatch( interfaceStore );

	useEffect( () => {
		if ( isActive && isSmall && ! previousIsSmall.current ) {
			disableComplementaryArea( INSPECTOR_SCOPE );
			shouldOpenWhenNotSmall.current = true;
		} else if (
			shouldOpenWhenNotSmall.current &&
			! isSmall &&
			previousIsSmall.current
		) {
			shouldOpenWhenNotSmall.current = false;
			enableComplementaryArea( INSPECTOR_SCOPE, identifier );
		} else if (
			shouldOpenWhenNotSmall.current &&
			activeArea &&
			activeArea !== identifier
		) {
			shouldOpenWhenNotSmall.current = false;
		}

		previousIsSmall.current = isSmall;
	}, [
		activeArea,
		disableComplementaryArea,
		enableComplementaryArea,
		identifier,
		isActive,
		isSmall,
	] );
}

function InspectorTabsHeader( { tabs } ) {
	if ( tabs.length === 0 ) {
		return null;
	}
	return (
		<Tabs.TabList>
			{ tabs.map( ( tab ) => (
				<Tabs.Tab
					key={ tab.id }
					tabId={ tab.id }
					data-tab-id={ tab.id }
				>
					{ tab.label }
				</Tabs.Tab>
			) ) }
		</Tabs.TabList>
	);
}

export function InspectorComplementaryArea( {
	children,
	identifier,
	isActiveByDefault,
	tabs,
	title,
} ) {
	const tabsContextValue = useContext( Tabs.Context );
	const { activeArea, isSmall } = useSelect(
		( select ) => ( {
			activeArea: getActiveInspectorArea( select ),
			isSmall: select( 'core/viewport' ).isViewportMatch( '< medium' ),
		} ),
		[]
	);
	const { enableComplementaryArea, disableComplementaryArea } =
		useDispatch( interfaceStore );
	const isActive = activeArea === identifier;
	useAdjustInspectorToViewport( {
		activeArea,
		identifier,
		isActive,
		isSmall,
	} );
	useEffect( () => {
		if ( activeArea !== undefined ) {
			return;
		}

		if ( isSmall ) {
			disableComplementaryArea( INSPECTOR_SCOPE );
		} else if ( isActiveByDefault ) {
			enableComplementaryArea( INSPECTOR_SCOPE, identifier );
		}
	}, [
		activeArea,
		disableComplementaryArea,
		enableComplementaryArea,
		identifier,
		isActiveByDefault,
		isSmall,
	] );
	const previousActiveAreaRef = useRef();
	const [ isRendered, setIsRendered ] = useState( isActive );
	const [ isOpen, setIsOpen ] = useState( isActive );
	const [ isAnimated, setIsAnimated ] = useState( false );
	const [ animationPhase, setAnimationPhase ] = useState( 'idle' );
	useEffect( () => {
		const previousActiveArea = previousActiveAreaRef.current;
		previousActiveAreaRef.current = activeArea;
		const isSwitchingAreas =
			Boolean( previousActiveArea ) &&
			Boolean( activeArea ) &&
			activeArea !== previousActiveArea;
		// The store uses `undefined` before initialization and `null` for an
		// explicit close. Skip animation on initialization or remount, but keep
		// it when the user reopens the inspector.
		const shouldAnimate =
			previousActiveArea !== undefined && ! isSwitchingAreas && ! isSmall;
		let removeTimer;
		let phaseTimer;

		setIsAnimated( shouldAnimate );
		setAnimationPhase( 'idle' );
		if ( isSwitchingAreas ) {
			setIsOpen( isActive );
			setIsRendered( isActive );
			return undefined;
		}

		if ( isActive ) {
			setIsRendered( true );
			setIsOpen( true );
			if ( shouldAnimate ) {
				setAnimationPhase( 'opening' );
				phaseTimer = window.setTimeout(
					() => setAnimationPhase( 'idle' ),
					INSPECTOR_ANIMATION_DURATION_MS
				);
			}
		} else {
			setIsOpen( false );
			if ( shouldAnimate ) {
				setAnimationPhase( 'closing' );
				removeTimer = window.setTimeout( () => {
					setIsRendered( false );
					setAnimationPhase( 'idle' );
				}, INSPECTOR_ANIMATION_DURATION_MS );
			} else {
				setIsRendered( false );
			}
		}

		return () => {
			if ( removeTimer ) {
				window.clearTimeout( removeTimer );
			}
			if ( phaseTimer ) {
				window.clearTimeout( phaseTimer );
			}
		};
	}, [ activeArea, isActive, isSmall ] );
	const fillClasses = [
		'interface-complementary-area__fill',
		'cortext-inspector-fill',
		isOpen ? 'is-open' : 'is-closed',
		isAnimated ? 'is-animated' : 'is-static',
		`is-${ animationPhase }`,
	].join( ' ' );
	const fillStyle = {
		'--cortext-inspector-animation-duration': `${ INSPECTOR_ANIMATION_DURATION_MS }ms`,
	};

	return (
		<Fill name={ INSPECTOR_SLOT }>
			{ isRendered ? (
				<div className={ fillClasses } style={ fillStyle }>
					<div
						id={ identifier.replace( '/', ':' ) }
						className="interface-complementary-area editor-sidebar__panel"
						aria-label={ title }
					>
						<div className="components-panel__header interface-complementary-area-header editor-sidebar__panel-tabs">
							<Tabs.Context.Provider value={ tabsContextValue }>
								<InspectorTabsHeader tabs={ tabs } />
							</Tabs.Context.Provider>
							<Button
								icon={ closeSmall }
								size="compact"
								label={ __( 'Close inspector', 'cortext' ) }
								aria-controls={ identifier.replace( '/', ':' ) }
								onClick={ () =>
									disableComplementaryArea( INSPECTOR_SCOPE )
								}
							/>
						</div>
						<Tabs.Context.Provider value={ tabsContextValue }>
							<Tabs.TabPanel
								tabId={ identifier }
								focusable={ false }
							>
								{ children }
							</Tabs.TabPanel>
						</Tabs.Context.Provider>
					</div>
				</div>
			) : null }
		</Fill>
	);
}

function InspectorToolGroup( { label, children } ) {
	return (
		<div className="cortext-document-inspector__tool">
			<div className="cortext-document-inspector__tool-label">
				{ label }
			</div>
			{ children }
		</div>
	);
}

function DocumentIconInspectorControls( { postId, postType } ) {
	const [ meta ] = useEntityProp( 'postType', postType, 'meta', postId );
	const iconMeta = meta?.cortext_document_icon ?? '';
	const { coverIndex, hasCoverBlock, iconBlockId } = useSelect(
		( select ) => {
			const blocks = select( blockEditorStore ).getBlocks();
			const coverBlock = blocks.find(
				( block ) => block?.name === 'cortext/document-cover'
			);
			const iconBlock = blocks.find(
				( block ) => block?.name === 'cortext/document-icon'
			);
			return {
				coverIndex: coverBlock ? blocks.indexOf( coverBlock ) : -1,
				hasCoverBlock: Boolean( coverBlock ),
				iconBlockId: iconBlock?.clientId ?? null,
			};
		},
		[]
	);
	const { insertBlocks, removeBlock, updateBlockAttributes } =
		useDispatch( blockEditorStore );
	const { editEntityRecord, saveEditedEntityRecord } =
		useDispatch( coreStore );
	const [ isRemoving, setIsRemoving ] = useState( false );

	const removeIconBlock = useCallback( () => {
		if ( ! iconBlockId ) {
			return;
		}
		updateBlockAttributes( iconBlockId, { lock: {} } );
		removeBlock( iconBlockId, false );
	}, [ iconBlockId, removeBlock, updateBlockAttributes ] );

	const syncIconBlock = useCallback(
		( nextMetaValue ) => {
			if ( ! nextMetaValue ) {
				removeIconBlock();
				return;
			}
			if ( iconBlockId ) {
				return;
			}
			const insertIndex = hasCoverBlock ? coverIndex + 1 : 0;
			insertBlocks(
				createBlock( 'cortext/document-icon', {
					lock: { move: true, remove: true },
				} ),
				insertIndex,
				undefined,
				false
			);
		},
		[
			coverIndex,
			hasCoverBlock,
			iconBlockId,
			insertBlocks,
			removeIconBlock,
		]
	);

	const removeIcon = useCallback( async () => {
		setIsRemoving( true );
		try {
			removeIconBlock();
			editEntityRecord( 'postType', postType, postId, {
				meta: { cortext_document_icon: '' },
			} );
			await saveEditedEntityRecord( 'postType', postType, postId );
		} finally {
			setIsRemoving( false );
		}
	}, [
		editEntityRecord,
		postId,
		postType,
		removeIconBlock,
		saveEditedEntityRecord,
	] );

	return (
		<InspectorToolGroup label={ __( 'Icon', 'cortext' ) }>
			<div className="cortext-document-inspector__control-row">
				{ iconMeta ? (
					<span
						className="cortext-document-inspector__icon-preview"
						aria-hidden="true"
					>
						<DocumentIcon icon={ iconMeta } size={ 24 } />
					</span>
				) : null }
				<DocumentIdentityControls
					postId={ postId }
					postType={ postType }
					currentIcon={ iconMeta }
					onAfterSave={ syncIconBlock }
					renderToggle={ ( { onToggle } ) => (
						<Button
							variant="secondary"
							onClick={ onToggle }
							__next40pxDefaultSize
						>
							{ iconMeta
								? __( 'Change', 'cortext' )
								: __( 'Add', 'cortext' ) }
						</Button>
					) }
				/>
				{ iconMeta ? (
					<Button
						variant="tertiary"
						isDestructive
						onClick={ removeIcon }
						isBusy={ isRemoving }
						disabled={ isRemoving }
						__next40pxDefaultSize
					>
						{ __( 'Remove', 'cortext' ) }
					</Button>
				) : null }
			</div>
		</InspectorToolGroup>
	);
}

function PageFeaturedImageInspectorControls( { postId, postType } ) {
	const [ featuredId, setFeaturedId ] = useEntityProp(
		'postType',
		postType,
		'featured_media',
		postId
	);
	const { record: media, isResolving: isResolvingMedia } = useEntityRecord(
		'root',
		'media',
		featuredId || 0
	);
	const coverBlockId = useSelect(
		( select ) =>
			select( blockEditorStore )
				.getBlocks()
				.find( ( block ) => block?.name === 'cortext/document-cover' )
				?.clientId ?? null,
		[]
	);
	const { insertBlocks, removeBlock, updateBlockAttributes } =
		useDispatch( blockEditorStore );
	const { saveEditedEntityRecord } = useDispatch( coreStore );
	const [ isSaving, setIsSaving ] = useState( false );

	const ensureCoverBlock = useCallback( () => {
		if ( coverBlockId ) {
			return;
		}
		insertBlocks(
			createBlock( 'cortext/document-cover', {
				align: 'full',
				lock: { move: true, remove: true },
			} ),
			0,
			undefined,
			false
		);
	}, [ coverBlockId, insertBlocks ] );

	const removeCoverBlock = useCallback( () => {
		if ( ! coverBlockId ) {
			return;
		}
		updateBlockAttributes( coverBlockId, { lock: {} } );
		removeBlock( coverBlockId, false );
	}, [ coverBlockId, removeBlock, updateBlockAttributes ] );

	const setFeaturedImage = useCallback(
		async ( picked ) => {
			setIsSaving( true );
			try {
				ensureCoverBlock();
				setFeaturedId( picked.id );
				await saveEditedEntityRecord( 'postType', postType, postId );
			} finally {
				setIsSaving( false );
			}
		},
		[
			ensureCoverBlock,
			postId,
			postType,
			saveEditedEntityRecord,
			setFeaturedId,
		]
	);

	const removeFeaturedImage = useCallback( async () => {
		setIsSaving( true );
		try {
			removeCoverBlock();
			setFeaturedId( 0 );
			await saveEditedEntityRecord( 'postType', postType, postId );
		} finally {
			setIsSaving( false );
		}
	}, [
		postId,
		postType,
		removeCoverBlock,
		saveEditedEntityRecord,
		setFeaturedId,
	] );

	const src =
		media?.media_details?.sizes?.thumbnail?.source_url ??
		media?.media_details?.sizes?.medium?.source_url ??
		media?.source_url ??
		null;
	const showMediaSkeleton = useDelayedFlag(
		isResolvingMedia && ! src,
		120,
		SKELETON_MIN_VISIBLE_MS
	);
	let featuredImagePreview = (
		<span>{ __( 'Featured image is not available.', 'cortext' ) }</span>
	);
	if ( isResolvingMedia && ! src ) {
		featuredImagePreview = showMediaSkeleton ? (
			<SkeletonBlock className="cortext-document-inspector__featured-image-skeleton" />
		) : null;
	} else if ( src ) {
		featuredImagePreview = (
			<img
				src={ src }
				alt={ media?.alt_text ?? '' }
				loading="lazy"
				decoding="async"
			/>
		);
	}

	return (
		<InspectorToolGroup label={ __( 'Featured image', 'cortext' ) }>
			{ featuredId > 0 ? (
				<div className="cortext-document-inspector__featured-image-preview">
					{ featuredImagePreview }
				</div>
			) : null }
			<div className="cortext-document-inspector__control-row">
				<MediaUploadCheck>
					<MediaPicker
						allowedTypes={ [ 'image' ] }
						postId={ postId }
						value={ featuredId }
						onSelect={ setFeaturedImage }
						render={ ( { open } ) => (
							<Button
								variant="secondary"
								onClick={ open }
								isBusy={ isSaving }
								disabled={ isSaving }
								__next40pxDefaultSize
							>
								{ featuredId > 0
									? __( 'Change', 'cortext' )
									: __( 'Add', 'cortext' ) }
							</Button>
						) }
					/>
				</MediaUploadCheck>
				{ featuredId > 0 ? (
					<Button
						variant="tertiary"
						isDestructive
						onClick={ removeFeaturedImage }
						isBusy={ isSaving }
						disabled={ isSaving }
						__next40pxDefaultSize
					>
						{ __( 'Remove', 'cortext' ) }
					</Button>
				) : null }
			</div>
		</InspectorToolGroup>
	);
}

function PageIdentityInspectorPanel( { postId, postType, title } ) {
	return (
		<PanelBody title={ title } initialOpen>
			<div className="cortext-document-inspector__tools">
				<DocumentIconInspectorControls
					postId={ postId }
					postType={ postType }
				/>
				<PageFeaturedImageInspectorControls
					postId={ postId }
					postType={ postType }
				/>
			</div>
		</PanelBody>
	);
}

function PageActionsPanel( { postId } ) {
	const { invalidateResolution, receiveEntityRecords } =
		useDispatch( coreStore );
	const { records: pages = [] } = useEntityRecords(
		'postType',
		POST_TYPE,
		ACTIVE_PAGES_QUERY
	);
	const { records: collections = [] } = useEntityRecords(
		'postType',
		DOCUMENT_POST_TYPE,
		FULL_PAGE_COLLECTION_QUERY
	);
	const { home, setHome, isUpdating: isHomeUpdating } = useWorkspaceHome();
	const {
		favorites,
		setFavorites,
		isResolving: isResolvingFavorites,
		isUpdating: isFavoriteUpdating,
	} = useFavorites();
	const [ isTrashing, setIsTrashing ] = useState( false );
	const [ error, setError ] = useState( null );
	const isHome = home?.id === postId;
	const isFavorite = favorites.some( ( favorite ) => favorite.id === postId );

	const togglePageFavorite = useCallback( async () => {
		setError( null );
		try {
			await setFavorites( ( current ) => {
				const nextIsFavorite = current.some(
					( favorite ) => favorite.id === postId
				);
				return nextIsFavorite
					? current.filter( ( favorite ) => favorite.id !== postId )
					: [ ...current, { id: postId } ];
			} );
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not update favorites.', 'cortext' )
			);
		}
	}, [ postId, setFavorites ] );

	const setAsHome = useCallback( async () => {
		if ( isHome ) {
			return;
		}
		setError( null );
		try {
			await setHome( { id: postId } );
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not set as home.', 'cortext' )
			);
		}
	}, [ isHome, postId, setHome ] );

	const trashPage = useCallback( async () => {
		setError( null );
		setIsTrashing( true );
		try {
			const deleted = await apiFetch( {
				path: `/wp/v2/crtxt_documents/${ postId }`,
				method: 'DELETE',
			} );
			const trashed = deleted?.previous ?? deleted;
			if ( trashed?.id ) {
				receiveEntityRecords( 'postType', POST_TYPE, [ trashed ] );
			}
			invalidateResolution( 'getEntityRecords', [
				'postType',
				POST_TYPE,
				ACTIVE_PAGES_QUERY,
			] );
			invalidateResolution( 'getEntityRecords', [
				'postType',
				POST_TYPE,
				TRASHED_PAGES_QUERY,
			] );
			// Page trash can also trash inline-owned and nested full-page
			// collections, so refresh the full-page list now.
			invalidateResolution( 'getEntityRecords', [
				'postType',
				DOCUMENT_POST_TYPE,
				FULL_PAGE_COLLECTION_QUERY,
			] );
			notifyDocumentTrashChanged();
			try {
				await setFavorites( ( current ) =>
					filterFavoritesForTrashedPage(
						current,
						postId,
						pages,
						collections
					)
				);
			} catch ( err ) {
				setError(
					err?.message ??
						__(
							'Document moved to Trash, but Favorites could not be updated.',
							'cortext'
						)
				);
			}
		} catch ( err ) {
			setError(
				err?.message ??
					__( 'Could not move document to Trash.', 'cortext' )
			);
		} finally {
			setIsTrashing( false );
		}
	}, [
		invalidateResolution,
		pages,
		collections,
		postId,
		receiveEntityRecords,
		setFavorites,
	] );

	return (
		<PanelBody title={ __( 'Actions', 'cortext' ) }>
			{ error ? (
				<Notice status="error" onRemove={ () => setError( null ) }>
					{ error }
				</Notice>
			) : null }
			<div className="cortext-document-inspector__actions">
				<Button
					className="cortext-document-inspector__action-button"
					variant="secondary"
					icon={ isFavorite ? starFilled : starEmpty }
					label={
						isFavorite
							? __( 'Remove from favorites', 'cortext' )
							: __( 'Add to favorites', 'cortext' )
					}
					onClick={ togglePageFavorite }
					isPressed={ isFavorite }
					isBusy={ isFavoriteUpdating }
					disabled={
						isFavoriteUpdating || isResolvingFavorites || ! postId
					}
					size="compact"
				/>
				<Button
					className="cortext-document-inspector__action-button"
					variant="secondary"
					icon={ homeIcon }
					label={
						isHome
							? __( 'Home', 'cortext' )
							: __( 'Set as home', 'cortext' )
					}
					onClick={ setAsHome }
					isPressed={ isHome }
					isBusy={ isHomeUpdating }
					disabled={ isHome || isHomeUpdating || ! postId }
					size="compact"
				/>
				<Button
					className="cortext-document-inspector__action-button"
					variant="secondary"
					icon={ trash }
					label={ __( 'Move to Trash', 'cortext' ) }
					isDestructive
					onClick={ trashPage }
					isBusy={ isTrashing }
					disabled={ isTrashing || ! postId }
					size="compact"
				/>
			</div>
		</PanelBody>
	);
}

function DocumentInspectorContent( { postId } ) {
	return (
		<div className="cortext-document-inspector">
			<PageIdentityInspectorPanel
				postId={ postId }
				postType={ POST_TYPE }
				title={ __( 'Identity', 'cortext' ) }
			/>
			<PageActionsPanel postId={ postId } />
			<BacklinksPanel documentId={ postId } />
		</div>
	);
}

// Collection inspector: identity controls first, then the owner data-view panels.
function CollectionInspectorContent( { postId, postType } ) {
	return (
		<div className="cortext-document-inspector">
			<PageIdentityInspectorPanel
				postId={ postId }
				postType={ postType }
				title={ __( 'Identity', 'cortext' ) }
			/>
			<CanvasOwnerInspector.Slot />
			<BacklinksPanel documentId={ postId } />
		</div>
	);
}

// Row inspector for property actions. Values stay in the document block; the
// sidebar handles visibility and field creation.
function RowInspectorContent( { postId } ) {
	return (
		<div className="cortext-row-inspector">
			<DocumentPropertiesActions />
			<BacklinksPanel documentId={ postId } />
		</div>
	);
}

function InspectorFrame( { children, isLocked } ) {
	return isLocked ? <Disabled>{ children }</Disabled> : children;
}

export default function DocumentInspectorSidebar( {
	isLocked = false,
	postId,
	postType,
} ) {
	const { record: currentRecord } = useEntityRecord(
		'postType',
		postType,
		postId || 0
	);
	const isCollection = definesTrait( currentRecord );
	const hasTrait =
		Array.isArray( currentRecord?.crtxt_trait ) &&
		currentRecord.crtxt_trait.length > 0;
	const documentTabLabel = __( 'Document', 'cortext' );
	const isTrashed = useSelect(
		( select ) =>
			select( editorStore ).getCurrentPostAttribute( 'status' ) ===
			'trash',
		[]
	);
	const isStoreLocked = useSelect(
		( select ) => select( editorStore ).isPostLocked?.() ?? false,
		[]
	);
	const isReadOnly = isTrashed || isLocked || isStoreLocked;
	const activeArea = useSelect(
		( select ) => getActiveInspectorArea( select ),
		[]
	);
	// Hide Block tabs that would be empty or redundant: no selection,
	// document-properties, or the canvas owner whose panels already live in the
	// document tab.
	const isCanvasOwnerSelected = useIsCanvasOwnerSelected( postType, postId );
	const showBlockTab = useSelect(
		( select ) => {
			const store = select( blockEditorStore );
			const clientId = store.getSelectedBlockClientId();
			if ( ! clientId ) {
				return false;
			}
			if ( isCanvasOwnerSelected ) {
				return false;
			}
			return (
				store.getBlockName( clientId ) !== 'cortext/document-properties'
			);
		},
		[ isCanvasOwnerSelected ]
	);
	const selectedTabId =
		isInspectorArea( activeArea ) &&
		( showBlockTab || activeArea !== BLOCK_INSPECTOR )
			? activeArea
			: DOCUMENT_INSPECTOR;
	const { enableComplementaryArea } = useDispatch( interfaceStore );
	useEffect( () => {
		if ( ! showBlockTab && activeArea === BLOCK_INSPECTOR ) {
			enableComplementaryArea( INSPECTOR_SCOPE, DOCUMENT_INSPECTOR );
		}
	}, [ activeArea, enableComplementaryArea, showBlockTab ] );
	const selectTab = useCallback(
		( nextTabId ) => {
			if ( isInspectorArea( nextTabId ) ) {
				enableComplementaryArea( INSPECTOR_SCOPE, nextTabId );
			}
		},
		[ enableComplementaryArea ]
	);

	const tabs = showBlockTab
		? [
				{ id: DOCUMENT_INSPECTOR, label: documentTabLabel },
				{ id: BLOCK_INSPECTOR, label: __( 'Block', 'cortext' ) },
		  ]
		: [ { id: DOCUMENT_INSPECTOR, label: documentTabLabel } ];

	return (
		<Tabs
			selectedTabId={ selectedTabId }
			onSelect={ selectTab }
			selectOnMove={ false }
		>
			<InspectorComplementaryArea
				identifier={ DOCUMENT_INSPECTOR }
				title={ documentTabLabel }
				isActiveByDefault
				tabs={ tabs }
			>
				<InspectorFrame isLocked={ isReadOnly }>
					{ isCollection && (
						<CollectionInspectorContent
							postId={ postId }
							postType={ postType }
						/>
					) }
					{ ! isCollection && hasTrait && (
						<RowInspectorContent postId={ postId } />
					) }
					{ ! isCollection && ! hasTrait && (
						<DocumentInspectorContent postId={ postId } />
					) }
				</InspectorFrame>
			</InspectorComplementaryArea>
			{ showBlockTab && (
				<InspectorComplementaryArea
					identifier={ BLOCK_INSPECTOR }
					title={ __( 'Block', 'cortext' ) }
					tabs={ tabs }
				>
					<InspectorFrame isLocked={ isReadOnly }>
						<BlockInspector />
					</InspectorFrame>
				</InspectorComplementaryArea>
			) }
		</Tabs>
	);
}
