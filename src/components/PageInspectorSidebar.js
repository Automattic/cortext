import {
	BlockInspector,
	store as blockEditorStore,
} from '@wordpress/block-editor';
import { createBlock } from '@wordpress/blocks';
import {
	Button,
	Disabled,
	Notice,
	PanelBody,
	privateApis as componentsPrivateApis,
} from '@wordpress/components';
import {
	useEntityProp,
	useEntityRecord,
	useEntityRecords,
	store as coreStore,
} from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import {
	PageAttributesPanel,
	PostURLPanel,
	store as editorStore,
} from '@wordpress/editor';
import {
	useCallback,
	useContext,
	useEffect,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import {
	home as homeIcon,
	starEmpty,
	starFilled,
	trash,
} from '@wordpress/icons';
import {
	ComplementaryArea,
	store as interfaceStore,
} from '@wordpress/interface';
import apiFetch from '@wordpress/api-fetch';

import MediaPicker, { MediaUploadCheck } from './MediaPicker';
import PageIcon from './PageIcon';
import DocumentIdentityControls from './DocumentIdentityControls';
import { SkeletonBlock } from './Skeleton';
import { filterFavoritesForTrashedPage } from './SidebarFavorites';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import { FULL_PAGE_COLLECTION_QUERY } from '../collections';
import { unlock } from '../lock-unlock';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';
import { useFavorites } from '../hooks/useFavorites';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';

const { Tabs } = unlock( componentsPrivateApis );

export const INSPECTOR_SCOPE = 'cortext';
export const PAGE_INSPECTOR = 'cortext/page-inspector';
export const BLOCK_INSPECTOR = 'cortext/block-inspector';

export function isInspectorArea( area ) {
	return area === PAGE_INSPECTOR || area === BLOCK_INSPECTOR;
}

export function InspectorSidebarSlot( props ) {
	return <ComplementaryArea.Slot scope={ INSPECTOR_SCOPE } { ...props } />;
}

function InspectorTabsHeader( { supportsPageInspector } ) {
	const tabs = supportsPageInspector
		? [
				{ id: PAGE_INSPECTOR, label: __( 'Page', 'cortext' ) },
				{ id: BLOCK_INSPECTOR, label: __( 'Block', 'cortext' ) },
		  ]
		: [ { id: BLOCK_INSPECTOR, label: __( 'Block', 'cortext' ) } ];

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

function InspectorComplementaryArea( {
	children,
	identifier,
	isActiveByDefault,
	supportsPageInspector,
	title,
} ) {
	const tabsContextValue = useContext( Tabs.Context );

	return (
		<ComplementaryArea
			scope={ INSPECTOR_SCOPE }
			identifier={ identifier }
			title={ title }
			closeLabel={ __( 'Close inspector', 'cortext' ) }
			isPinnable={ false }
			isActiveByDefault={ isActiveByDefault }
			className="editor-sidebar__panel"
			headerClassName="editor-sidebar__panel-tabs"
			header={
				<Tabs.Context.Provider value={ tabsContextValue }>
					<InspectorTabsHeader
						supportsPageInspector={ supportsPageInspector }
					/>
				</Tabs.Context.Provider>
			}
		>
			<Tabs.Context.Provider value={ tabsContextValue }>
				<Tabs.TabPanel tabId={ identifier } focusable={ false }>
					{ children }
				</Tabs.TabPanel>
			</Tabs.Context.Provider>
		</ComplementaryArea>
	);
}

function PageLinkPanel() {
	const isVisible = useSelect( ( select ) => {
		const editor = select( editorStore );
		const postTypeSlug = editor.getCurrentPostType();
		const postType = select( coreStore ).getPostType( postTypeSlug );
		if ( ! postType?.viewable ) {
			return false;
		}
		if ( ! editor.getCurrentPost()?.link ) {
			return false;
		}
		return Boolean( editor.getPermalinkParts() );
	}, [] );

	if ( ! isVisible ) {
		return null;
	}

	return (
		<PanelBody title={ __( 'Link', 'cortext' ) }>
			<PostURLPanel />
		</PanelBody>
	);
}

function PageAttributesInspectorPanel() {
	const supportsPageAttributes = useSelect( ( select ) => {
		const editor = select( editorStore );
		const postType = select( coreStore ).getPostType(
			editor.getEditedPostAttribute( 'type' )
		);
		return Boolean( postType?.supports?.[ 'page-attributes' ] );
	}, [] );

	if ( ! supportsPageAttributes ) {
		return null;
	}

	return (
		<PanelBody title={ __( 'Page attributes', 'cortext' ) }>
			<PageAttributesPanel />
		</PanelBody>
	);
}

function InspectorToolGroup( { label, children } ) {
	return (
		<div className="cortext-page-inspector__tool">
			<div className="cortext-page-inspector__tool-label">{ label }</div>
			{ children }
		</div>
	);
}

function PageIconInspectorControls( { postId } ) {
	const [ meta ] = useEntityProp( 'postType', POST_TYPE, 'meta', postId );
	const iconMeta = meta?.cortext_document_icon ?? '';
	const { coverIndex, hasCoverBlock, iconBlockId } = useSelect(
		( select ) => {
			const blocks = select( blockEditorStore ).getBlocks();
			const coverBlock = blocks.find(
				( block ) => block.name === 'cortext/document-cover'
			);
			const iconBlock = blocks.find(
				( block ) => block.name === 'cortext/document-icon'
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
					lock: { move: true },
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
			editEntityRecord( 'postType', POST_TYPE, postId, {
				meta: { cortext_document_icon: '' },
			} );
			await saveEditedEntityRecord( 'postType', POST_TYPE, postId );
		} finally {
			setIsRemoving( false );
		}
	}, [ editEntityRecord, postId, removeIconBlock, saveEditedEntityRecord ] );

	return (
		<InspectorToolGroup label={ __( 'Icon', 'cortext' ) }>
			<div className="cortext-page-inspector__control-row">
				{ iconMeta ? (
					<span
						className="cortext-page-inspector__icon-preview"
						aria-hidden="true"
					>
						<PageIcon icon={ iconMeta } size={ 24 } />
					</span>
				) : null }
				<DocumentIdentityControls
					postId={ postId }
					postType={ POST_TYPE }
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

function PageFeaturedImageInspectorControls( { postId } ) {
	const [ featuredId, setFeaturedId ] = useEntityProp(
		'postType',
		POST_TYPE,
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
				.find( ( block ) => block.name === 'cortext/document-cover' )
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
				lock: { move: true },
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
				await saveEditedEntityRecord( 'postType', POST_TYPE, postId );
			} finally {
				setIsSaving( false );
			}
		},
		[ ensureCoverBlock, postId, saveEditedEntityRecord, setFeaturedId ]
	);

	const removeFeaturedImage = useCallback( async () => {
		setIsSaving( true );
		try {
			removeCoverBlock();
			setFeaturedId( 0 );
			await saveEditedEntityRecord( 'postType', POST_TYPE, postId );
		} finally {
			setIsSaving( false );
		}
	}, [ postId, removeCoverBlock, saveEditedEntityRecord, setFeaturedId ] );

	const src =
		media?.media_details?.sizes?.thumbnail?.source_url ??
		media?.media_details?.sizes?.medium?.source_url ??
		media?.source_url ??
		null;
	let featuredImagePreview = (
		<span>{ __( 'Featured image is not available.', 'cortext' ) }</span>
	);
	if ( isResolvingMedia && ! src ) {
		featuredImagePreview = (
			<SkeletonBlock className="cortext-page-inspector__featured-image-skeleton" />
		);
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
				<div className="cortext-page-inspector__featured-image-preview">
					{ featuredImagePreview }
				</div>
			) : null }
			<div className="cortext-page-inspector__control-row">
				<MediaUploadCheck>
					<MediaPicker
						allowedTypes={ [ 'image' ] }
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

function PageIdentityInspectorPanel( { postId } ) {
	return (
		<PanelBody title={ __( 'Page identity', 'cortext' ) } initialOpen>
			<div className="cortext-page-inspector__tools">
				<PageIconInspectorControls postId={ postId } />
				<PageFeaturedImageInspectorControls postId={ postId } />
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
		'crtxt_collection',
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
	const isHome = home?.kind === 'page' && home.id === postId;
	const isFavorite = favorites.some(
		( favorite ) => favorite.kind === 'page' && favorite.id === postId
	);

	const togglePageFavorite = useCallback( async () => {
		setError( null );
		try {
			await setFavorites( ( current ) => {
				const nextIsFavorite = current.some(
					( favorite ) =>
						favorite.kind === 'page' && favorite.id === postId
				);
				return nextIsFavorite
					? current.filter(
							( favorite ) =>
								! (
									favorite.kind === 'page' &&
									favorite.id === postId
								)
					  )
					: [ ...current, { kind: 'page', id: postId } ];
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
			await setHome( { kind: 'page', id: postId } );
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not set page as home.', 'cortext' )
			);
		}
	}, [ isHome, postId, setHome ] );

	const trashPage = useCallback( async () => {
		setError( null );
		setIsTrashing( true );
		try {
			const deleted = await apiFetch( {
				path: `/wp/v2/crtxt_pages/${ postId }`,
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
				'crtxt_collection',
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
							'Page moved to Trash, but Favorites could not be updated.',
							'cortext'
						)
				);
			}
		} catch ( err ) {
			setError(
				err?.message ?? __( 'Could not move page to Trash.', 'cortext' )
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
			<div className="cortext-page-inspector__actions">
				<Button
					className="cortext-page-inspector__action-button"
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
					className="cortext-page-inspector__action-button"
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
					className="cortext-page-inspector__action-button"
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

function PageInspectorContent( { postId } ) {
	return (
		<div className="cortext-page-inspector">
			<PageIdentityInspectorPanel postId={ postId } />
			<PageLinkPanel />
			<PageAttributesInspectorPanel />
			<PageActionsPanel postId={ postId } />
		</div>
	);
}

function InspectorFrame( { children, isTrashed } ) {
	return isTrashed ? <Disabled>{ children }</Disabled> : children;
}

export default function PageInspectorSidebar( { postId, postType } ) {
	const supportsPageInspector = postType === POST_TYPE;
	const isTrashed = useSelect(
		( select ) =>
			select( editorStore ).getCurrentPostAttribute( 'status' ) ===
			'trash',
		[]
	);
	const activeArea = useSelect(
		( select ) =>
			select( interfaceStore ).getActiveComplementaryArea(
				INSPECTOR_SCOPE
			),
		[]
	);
	const selectedTabId = isInspectorArea( activeArea )
		? activeArea
		: PAGE_INSPECTOR;
	const { enableComplementaryArea } = useDispatch( interfaceStore );
	useEffect( () => {
		if ( ! supportsPageInspector && activeArea === PAGE_INSPECTOR ) {
			enableComplementaryArea( INSPECTOR_SCOPE, BLOCK_INSPECTOR );
		}
	}, [ activeArea, enableComplementaryArea, supportsPageInspector ] );
	const selectTab = useCallback(
		( nextTabId ) => {
			if ( isInspectorArea( nextTabId ) ) {
				enableComplementaryArea( INSPECTOR_SCOPE, nextTabId );
			}
		},
		[ enableComplementaryArea ]
	);

	if ( ! supportsPageInspector ) {
		return (
			<ComplementaryArea
				scope={ INSPECTOR_SCOPE }
				identifier={ BLOCK_INSPECTOR }
				title={ __( 'Block', 'cortext' ) }
				closeLabel={ __( 'Close inspector', 'cortext' ) }
				isPinnable={ false }
				isActiveByDefault
			>
				<InspectorFrame isTrashed={ isTrashed }>
					<BlockInspector />
				</InspectorFrame>
			</ComplementaryArea>
		);
	}

	return (
		<Tabs
			selectedTabId={ selectedTabId }
			onSelect={ selectTab }
			selectOnMove={ false }
		>
			<InspectorComplementaryArea
				identifier={ PAGE_INSPECTOR }
				title={ __( 'Page', 'cortext' ) }
				isActiveByDefault
				supportsPageInspector={ supportsPageInspector }
			>
				<InspectorFrame isTrashed={ isTrashed }>
					<PageInspectorContent postId={ postId } />
				</InspectorFrame>
			</InspectorComplementaryArea>
			<InspectorComplementaryArea
				identifier={ BLOCK_INSPECTOR }
				title={ __( 'Block', 'cortext' ) }
				supportsPageInspector={ supportsPageInspector }
			>
				<InspectorFrame isTrashed={ isTrashed }>
					<BlockInspector />
				</InspectorFrame>
			</InspectorComplementaryArea>
		</Tabs>
	);
}
