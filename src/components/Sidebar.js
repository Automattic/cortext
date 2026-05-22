import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useState, useMemo, useCallback, useEffect } from '@wordpress/element';
import { Button, Icon, Notice } from '@wordpress/components';
import { displayShortcut } from '@wordpress/keycodes';
import {
	globe,
	home as homeIcon,
	plus,
	search,
	trash as trashIcon,
	wordpress,
} from '@wordpress/icons';

// Sidebar toggle: panel outline with a vertical accent on
// the left side. Same icon for both states; the aria-label tells the
// user what the toggle will do.
const sidebarToggleIcon = (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		width="24"
		height="24"
		aria-hidden="true"
		focusable="false"
	>
		<rect
			x="4"
			y="5"
			width="16"
			height="14"
			rx="2"
			stroke="currentColor"
			strokeWidth="1.5"
			fill="none"
		/>
		<line
			x1="9"
			y1="5"
			x2="9"
			y2="19"
			stroke="currentColor"
			strokeWidth="1.5"
		/>
	</svg>
);

const cortextMarkIcon = (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		width="24"
		height="24"
		aria-hidden="true"
		focusable="false"
	>
		<ellipse
			cx="12"
			cy="12"
			rx="7"
			ry="6"
			stroke="currentColor"
			strokeWidth="1.6"
			fill="none"
		/>
		<path
			d="M12 6v12M8.5 8.5 12 10l3.5-1.5"
			stroke="currentColor"
			strokeWidth="1.4"
			strokeLinecap="round"
			fill="none"
		/>
		<circle cx="12" cy="10" r="0.9" fill="currentColor" />
	</svg>
);
import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';

import { openCommandPalette } from './CommandPalette';
import SidebarFavorites, { favoriteKey } from './SidebarFavorites';
import SidebarResizeHandle from './SidebarResizeHandle';
import SidebarRecents from './SidebarRecents';
import SidebarSection from './SidebarSection';
import { SidebarListSkeleton } from './Skeleton';
import SidebarTrash, { computeSidebarTrashRoots } from './SidebarTrash';
import ThemeToggle from './ThemeToggle';
import { nextChildOrder } from './pages-tree';
import { POST_TYPE } from './page-queries';
import {
	PUBLISHED_DOCUMENTS_URI,
	computeCollectionUri,
} from '../router/useResolveEntity';
import { FULL_PAGE_COLLECTION_QUERY } from '../collections';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useFavorites } from '../hooks/useFavorites';
import useSidebarSections from '../hooks/useSidebarSections';
import useTrashedDocuments from '../hooks/useTrashedDocuments';
import { useWorkspaceHomePath } from '../hooks/useWorkspaceHomePath';
import {
	DocumentsProvider,
	favoriteIdentForRecord,
	favoriteKeyForRecord,
	useDocumentSelection,
} from '../documents';
import useSidebarDnd from './sidebar/useSidebarDnd';
import useSidebarNavigation from './sidebar/useSidebarNavigation';
import useSidebarTree from './sidebar/useSidebarTree';
import DocumentRow from './sidebar/DocumentRow';

export default function Sidebar( {
	collapsed = false,
	width,
	onToggleCollapsed,
	onWidthChange,
} ) {
	// tech-debt.md#53: this tree still comes from flat REST lists capped at
	// `per_page: 100`. The follow-up is lazy loading or a paged tree endpoint.
	const { records: collections, isResolving: isResolvingCollections } =
		useEntityRecords(
			'postType',
			'crtxt_collection',
			FULL_PAGE_COLLECTION_QUERY
		);
	const trashedDocumentsState = useTrashedDocuments();
	const {
		pages,
		homePath,
		home,
		setHome,
		isResolvingHomePath,
		isResolvingPages,
		isUpdating: isHomeUpdating,
	} = useWorkspaceHomePath();
	const showPagesSkeleton = useDelayedFlag(
		isResolvingPages && pages.length === 0,
		120,
		SKELETON_MIN_VISIBLE_MS
	);
	const {
		favorites,
		setFavorites,
		isResolving: isResolvingFavorites,
		isUpdating: isUpdatingFavorites,
	} = useFavorites();
	const { saveEntityRecord, invalidateResolution } = useDispatch( 'core' );
	const {
		navigate,
		activeUri,
		selectedId,
		selectedCollectionId,
		onSelect,
		goHome,
	} = useSidebarNavigation( { pages, homePath } );
	const adminUrl = window.cortextSettings?.adminUrl ?? '/wp-admin/';
	const userName = window.cortextSettings?.userDisplayName ?? '';
	const commandPaletteShortcut = displayShortcut.primary( 'k' );
	const brandLabel = userName
		? sprintf(
				/* translators: %s: user display name */
				__( "%s's Cortext", 'cortext' ),
				userName
		  )
		: __( 'Cortext', 'cortext' );

	const [ favoritesError, setFavoritesError ] = useState( null );
	const [ duplicateNotice, setDuplicateNotice ] = useState( null );
	const areFavoriteActionsDisabled =
		isResolvingFavorites || isUpdatingFavorites;
	const { isSectionCollapsed, toggleSection } = useSidebarSections();
	const goPublished = useCallback( () => {
		navigate( {
			to: '/$',
			params: { _splat: PUBLISHED_DOCUMENTS_URI },
		} );
	}, [ navigate ] );
	const isPublishedActive = activeUri === PUBLISHED_DOCUMENTS_URI;
	const toggleTrashPanel = useCallback( () => {
		if ( collapsed ) {
			setIsTrashPanelOpen( true );
			onToggleCollapsed?.();
			return;
		}
		setIsTrashPanelOpen( ( current ) => ! current );
	}, [ collapsed, onToggleCollapsed ] );

	const favoriteKeys = useMemo(
		() =>
			new Set( favorites.map( ( favorite ) => favoriteKey( favorite ) ) ),
		[ favorites ]
	);
	const isFavorite = useCallback(
		( record ) => {
			const key = favoriteKeyForRecord( record );
			return key !== null && favoriteKeys.has( key );
		},
		[ favoriteKeys ]
	);
	// `target` is either a raw record (from a row's menu) or an existing
	// `{ kind, id }` favorite (from SidebarFavorites' remove button).
	// `favoriteIdentForRecord` accepts both by reading `kind` directly or
	// deriving it from `type`.
	const toggleFavorite = useCallback(
		async ( target ) => {
			if ( areFavoriteActionsDisabled ) {
				return;
			}
			const ident = favoriteIdentForRecord( target );
			if ( ! ident ) {
				return;
			}
			const key = favoriteKey( ident );
			setFavoritesError( null );
			try {
				await setFavorites( ( current ) => {
					const exists = current.some(
						( favorite ) => favoriteKey( favorite ) === key
					);
					return exists
						? current.filter(
								( favorite ) => favoriteKey( favorite ) !== key
						  )
						: [ ...current, ident ];
				} );
			} catch ( err ) {
				setFavoritesError(
					err?.message ??
						__( 'Could not update favorites.', 'cortext' )
				);
			}
		},
		[ areFavoriteActionsDisabled, setFavorites ]
	);
	const reorderFavorites = useCallback(
		async ( next ) => {
			if ( areFavoriteActionsDisabled ) {
				return;
			}
			setFavoritesError( null );
			try {
				await setFavorites( next );
			} catch ( err ) {
				setFavoritesError(
					err?.message ??
						__( 'Could not reorder favorites.', 'cortext' )
				);
			}
		},
		[ areFavoriteActionsDisabled, setFavorites ]
	);
	const selectFavorite = useCallback(
		( favorite ) => {
			if (
				( ( favorite.kind === 'page' || favorite.kind === 'row' ) &&
					favorite.id === selectedId ) ||
				( favorite.kind === 'collection' &&
					favorite.id === selectedCollectionId )
			) {
				return false;
			}
			navigate( {
				to: '/$',
				params: { _splat: favorite.path },
			} );
			return true;
		},
		[ navigate, selectedCollectionId, selectedId ]
	);

	const { topLevelCollections, tree, expandedIds, toggleExpand, expand } =
		useSidebarTree( {
			pages,
			collections,
			selectedId,
			selectedCollectionId,
		} );

	// `draggedId` and `activeDrop` flow into the per-row callbacks below, so
	// the DnD hook has to resolve before any `useCallback` that lists them as
	// deps. Otherwise their `const` bindings sit in the temporal dead zone
	// when the callback's dep array is evaluated and React throws on render.
	const { sensors, draggedId, draggedPage, activeDrop, handlers } =
		useSidebarDnd( {
			pages,
			collections,
			expandedIds,
			expand,
			saveEntityRecord,
		} );

	const showCollectionsSkeleton = useDelayedFlag(
		isResolvingCollections && topLevelCollections.length === 0,
		120,
		SKELETON_MIN_VISIBLE_MS
	);

	const [ autoRenameId, setAutoRenameId ] = useState( null );
	const [ isTrashPanelOpen, setIsTrashPanelOpen ] = useState( false );
	const trashCount = useMemo( () => {
		if ( Array.isArray( trashedDocumentsState.documents ) ) {
			return computeSidebarTrashRoots( trashedDocumentsState.documents )
				.roots.length;
		}
		return trashedDocumentsState.total;
	}, [ trashedDocumentsState.documents, trashedDocumentsState.total ] );
	let trashButtonLabel = __( 'Open Trash', 'cortext' );
	if ( isTrashPanelOpen ) {
		trashButtonLabel = __( 'Close Trash', 'cortext' );
	} else if ( trashCount > 0 ) {
		trashButtonLabel = sprintf(
			/* translators: %d: number of trashed pages and rows */
			_n(
				'Open Trash, %d item',
				'Open Trash, %d items',
				trashCount,
				'cortext'
			),
			trashCount
		);
	}

	useEffect( () => {
		if ( collapsed ) {
			setIsTrashPanelOpen( false );
		}
	}, [ collapsed ] );

	// --- Create actions (kept here because they target the workspace, not
	// an existing document, and they need autoRenameId + selection state).

	const createRootPage = useCallback( async () => {
		const created = await saveEntityRecord( 'postType', POST_TYPE, {
			status: 'draft',
		} );
		if ( created?.id ) {
			onSelect( created.id, created );
			setAutoRenameId( created.id );
		}
	}, [ saveEntityRecord, onSelect ] );

	const createRootCollection = useCallback( async () => {
		const created = await apiFetch( {
			path: '/wp/v2/crtxt_collections',
			method: 'POST',
			data: {
				title: __( 'Untitled', 'cortext' ),
				status: 'private',
				mode: 'full_page',
			},
		} );
		invalidateResolution( 'getEntityRecords', [
			'postType',
			'crtxt_collection',
			FULL_PAGE_COLLECTION_QUERY,
		] );
		// tech-debt.md#2: core-data may have cached `/wp/v2/types` before this
		// collection registered its row CPT. Refresh the entity config so row
		// lookups can find the new post type.
		invalidateResolution( 'getEntitiesConfig', [ 'postType' ] );
		if ( created?.id ) {
			navigate( {
				to: '/$',
				params: { _splat: computeCollectionUri( created ) },
			} );
		}
	}, [ invalidateResolution, navigate ] );

	const createChildPage = useCallback(
		async ( parentId ) => {
			const created = await saveEntityRecord( 'postType', POST_TYPE, {
				status: 'draft',
				parent: parentId,
				menu_order: nextChildOrder( parentId, pages ),
			} );
			if ( created?.id ) {
				expand( parentId );
				onSelect( created.id, created );
				setAutoRenameId( created.id );
			}
		},
		[ saveEntityRecord, pages, expand, onSelect ]
	);

	// --- Per-row selection helpers --------------------------------------

	const { isSelected: isRowSelected, selectRecord: onRowSelect } =
		useDocumentSelection( { selectedId, selectedCollectionId } );

	const onSetRowHome = useCallback(
		async ( record ) => {
			const ident = favoriteIdentForRecord( record );
			if ( ! ident ) {
				return;
			}
			try {
				await setHome( ident );
			} catch {}
		},
		[ setHome ]
	);

	const isRowHome = useCallback(
		( record ) => {
			if ( ! home ) {
				return false;
			}
			return favoriteKey( home ) === favoriteKeyForRecord( record );
		},
		[ home ]
	);

	// Callbacks for document descriptors. The page tree and collection list
	// stay out of this: trash cascades now come from the server response, so
	// descriptors do not need to walk local trees.
	const documentsHandlers = useMemo(
		() => ( {
			selectedCollectionId,
			expand,
			onSelect,
			onAutoRename: ( target ) => setAutoRenameId( target?.id ?? null ),
			onAfterTrash: () => setIsTrashPanelOpen( true ),
			onDuplicateNotice: setDuplicateNotice,
			onFavoritesError: setFavoritesError,
		} ),
		[ selectedCollectionId, expand, onSelect ]
	);

	// Props shared by every DocumentRow. Keeping them together makes the Pages
	// and Collections sections use the same selection, DnD, and menu behavior.
	const rowChrome = {
		expandedIds,
		draggedId,
		activeDrop,
		isSelected: isRowSelected,
		onSelect: onRowSelect,
		onToggleExpand: toggleExpand,
		onCreateChild: createChildPage,
		isFavorite,
		isFavoriteDisabled: areFavoriteActionsDisabled,
		onToggleFavorite: toggleFavorite,
		isHome: isRowHome,
		onSetHome: onSetRowHome,
		isHomeUpdating,
		autoRenameId,
		onAutoRenameConsumed: () => setAutoRenameId( null ),
	};

	// --- Render ------------------------------------------------------------

	return (
		<aside
			id="cortext-sidebar"
			className="cortext-sidebar"
			data-collapsed={ collapsed ? 'true' : 'false' }
		>
			<div className="cortext-sidebar__header">
				{ ! collapsed && (
					<span className="cortext-sidebar__brand">
						<span
							className="cortext-sidebar__brand-mark"
							aria-hidden="true"
						>
							{ cortextMarkIcon }
						</span>
						<span className="cortext-sidebar__brand-text">
							{ brandLabel }
						</span>
					</span>
				) }
				<Button
					className="cortext-sidebar__collapse-toggle"
					icon={ sidebarToggleIcon }
					label={
						collapsed
							? __( 'Expand sidebar', 'cortext' )
							: __( 'Collapse sidebar', 'cortext' )
					}
					onClick={ onToggleCollapsed }
				/>
			</div>
			<div
				className="cortext-sidebar__quick-actions"
				role="toolbar"
				aria-label={ __( 'Quick actions', 'cortext' ) }
			>
				<Button
					className="cortext-sidebar__quick-action cortext-sidebar__quick-action--search"
					label={ __( 'Search or run a command', 'cortext' ) }
					onClick={ () => openCommandPalette() }
				>
					<Icon icon={ search } size={ 16 } />
					{ ! collapsed && (
						<>
							<span className="cortext-sidebar__quick-action-label">
								{ __( 'Search or run a command', 'cortext' ) }
							</span>
							<kbd className="cortext-sidebar__quick-action-kbd">
								{ commandPaletteShortcut }
							</kbd>
						</>
					) }
				</Button>
				<Button
					className="cortext-sidebar__quick-action cortext-sidebar__quick-action--home"
					label={ __( 'Home', 'cortext' ) }
					disabled={ ! homePath || isResolvingHomePath }
					onClick={ goHome }
				>
					<Icon icon={ homeIcon } size={ 16 } />
					{ ! collapsed && <span>{ __( 'Home', 'cortext' ) }</span> }
				</Button>
				<Button
					className="cortext-sidebar__quick-action cortext-sidebar__quick-action--published"
					label={ __( 'Published documents', 'cortext' ) }
					isPressed={ isPublishedActive }
					onClick={ goPublished }
				>
					<Icon icon={ globe } size={ 16 } />
					{ ! collapsed && (
						<span>{ __( 'Published documents', 'cortext' ) }</span>
					) }
				</Button>
			</div>
			{ ! collapsed && (
				<DocumentsProvider { ...documentsHandlers }>
					<div className="cortext-sidebar__content">
						{ favoritesError ? (
							<Notice
								status="error"
								onRemove={ () => setFavoritesError( null ) }
							>
								{ favoritesError }
							</Notice>
						) : null }
						{ duplicateNotice ? (
							<Notice
								status="warning"
								onRemove={ () => setDuplicateNotice( null ) }
							>
								{ duplicateNotice }
							</Notice>
						) : null }
						<SidebarSection
							id="recents"
							title={ __( 'Recents', 'cortext' ) }
							isCollapsed={ isSectionCollapsed( 'recents' ) }
							onToggle={ () => toggleSection( 'recents' ) }
						>
							<SidebarRecents />
						</SidebarSection>

						<SidebarSection
							id="favorites"
							title={ __( 'Favorites', 'cortext' ) }
							isCollapsed={ isSectionCollapsed( 'favorites' ) }
							onToggle={ () => toggleSection( 'favorites' ) }
						>
							<SidebarFavorites
								favorites={ favorites }
								pages={ pages }
								collections={ collections ?? [] }
								isResolving={ isResolvingFavorites }
								isResolvingItems={
									isResolvingPages || isResolvingCollections
								}
								isDisabled={ areFavoriteActionsDisabled }
								onSelect={ selectFavorite }
								onRemove={ toggleFavorite }
								onReorder={ reorderFavorites }
							/>
						</SidebarSection>

						{ /* One DndContext wraps both sections so top-level
						     collections (rendered in the Collections section
						     below) are part of the same drag/drop graph as
						     the Pages tree. Without this, top-level
						     collection rows would register their useDraggable
						     / useDroppable hooks outside any provider and
						     the gesture would never fire. */ }
						<DndContext
							sensors={ sensors }
							collisionDetection={ pointerWithin }
							onDragStart={ handlers.handleDragStart }
							onDragOver={ handlers.handleDragOver }
							onDragEnd={ handlers.handleDragEnd }
							onDragCancel={ handlers.handleDragCancel }
						>
							<SidebarSection
								id="pages"
								title={ __( 'Pages', 'cortext' ) }
								isCollapsed={ isSectionCollapsed( 'pages' ) }
								onToggle={ () => toggleSection( 'pages' ) }
								actions={
									<Button
										className="cortext-sidebar__section-action"
										icon={ plus }
										size="small"
										label={ __( 'New page', 'cortext' ) }
										onClick={ createRootPage }
									/>
								}
							>
								{ isResolvingPages &&
									pages.length === 0 &&
									showPagesSkeleton && (
										<SidebarListSkeleton itemCount={ 5 } />
									) }
								{ ! isResolvingPages && pages.length === 0 && (
									<p className="cortext-sidebar__empty">
										{ __( 'No pages yet.', 'cortext' ) }
									</p>
								) }

								<ul className="cortext-sidebar__list">
									{ tree.map( ( node ) => (
										<DocumentRow
											key={ node.page.id }
											record={ node.page }
											childNodes={ node.children }
											depth={ 0 }
											{ ...rowChrome }
										/>
									) ) }
								</ul>
							</SidebarSection>

							<SidebarSection
								id="collections"
								title={ __( 'Collections', 'cortext' ) }
								isCollapsed={ isSectionCollapsed(
									'collections'
								) }
								onToggle={ () =>
									toggleSection( 'collections' )
								}
								actions={
									<Button
										className="cortext-sidebar__section-action"
										icon={ plus }
										size="small"
										label={ __(
											'New collection',
											'cortext'
										) }
										onClick={ createRootCollection }
									/>
								}
							>
								{ isResolvingCollections &&
									topLevelCollections.length === 0 &&
									showCollectionsSkeleton && (
										<SidebarListSkeleton itemCount={ 3 } />
									) }
								{ ! isResolvingCollections &&
									topLevelCollections.length === 0 && (
										<p className="cortext-sidebar__empty">
											{ __(
												'No collections yet.',
												'cortext'
											) }
										</p>
									) }
								{ topLevelCollections.length > 0 && (
									<ul className="cortext-sidebar__list">
										{ topLevelCollections.map(
											( collection ) => (
												<DocumentRow
													key={ collection.id }
													record={ collection }
													depth={ 0 }
													{ ...rowChrome }
												/>
											)
										) }
									</ul>
								) }
							</SidebarSection>

							<DragOverlay>
								{ draggedPage ? (
									<div className="cortext-sidebar__drag-preview">
										{ draggedPage.title?.rendered?.trim() ||
											__( '(untitled)', 'cortext' ) }
									</div>
								) : null }
							</DragOverlay>
						</DndContext>
					</div>
					{ isTrashPanelOpen && (
						<section
							id="cortext-sidebar-trash-panel"
							className="cortext-sidebar__trash-panel"
							aria-label={ __( 'Trash', 'cortext' ) }
						>
							<div className="cortext-sidebar__trash-panel-header">
								<h2 className="cortext-sidebar__section-title">
									{ __( 'Trash', 'cortext' ) }
								</h2>
							</div>
							<SidebarTrash
								activePages={ pages }
								selectedId={ selectedId }
								selectedCollectionId={ selectedCollectionId }
								onSelect={ onSelect }
								trashedDocumentsState={ trashedDocumentsState }
							/>
						</section>
					) }
				</DocumentsProvider>
			) }
			<div className="cortext-sidebar__footer">
				<div className="cortext-sidebar__footer-group cortext-sidebar__footer-group--navigation">
					<Button
						className="cortext-sidebar__footer-button cortext-sidebar__trash-footer"
						label={ trashButtonLabel }
						aria-expanded={ ! collapsed && isTrashPanelOpen }
						aria-controls="cortext-sidebar-trash-panel"
						isPressed={ ! collapsed && isTrashPanelOpen }
						onClick={ toggleTrashPanel }
					>
						<Icon icon={ trashIcon } size={ 20 } />
						{ trashCount > 0 && (
							<span
								className="cortext-sidebar__footer-count"
								aria-hidden="true"
							>
								{ trashCount > 99 ? '99+' : trashCount }
							</span>
						) }
					</Button>
				</div>
				<div className="cortext-sidebar__footer-spacer" />
				<div
					className="cortext-sidebar__footer-separator"
					aria-hidden="true"
				/>
				<div className="cortext-sidebar__footer-group cortext-sidebar__footer-group--preferences">
					<ThemeToggle />
					<Button
						className="cortext-sidebar__back"
						label={ __( 'Go to WordPress', 'cortext' ) }
						href={ adminUrl }
						icon={ <Icon icon={ wordpress } size={ 24 } /> }
					/>
				</div>
			</div>
			{ ! collapsed && (
				<SidebarResizeHandle
					width={ width }
					onChange={ onWidthChange }
					onToggleCollapsed={ onToggleCollapsed }
				/>
			) }
		</aside>
	);
}
