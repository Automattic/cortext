import { __, _n, sprintf } from '@wordpress/i18n';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import {
	useState,
	useMemo,
	useCallback,
	useEffect,
	useRef,
} from '@wordpress/element';
import { useParams } from '@tanstack/react-router';
import {
	Button,
	Dropdown,
	Icon,
	MenuGroup,
	MenuItem,
	Notice,
} from '@wordpress/components';
import { displayShortcut } from '@wordpress/keycodes';
import {
	archive as archiveIcon,
	chevronDown,
	cog,
	home as homeIcon,
	page,
	plus,
	search,
	wordpress,
} from '@wordpress/icons';

import './Sidebar.scss';

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

import { DndContext, DragOverlay, pointerWithin } from '@dnd-kit/core';

import { openCommandPalette } from './CommandPalette';
import { collectionIcon } from './cortextIcons';
import SidebarFavorites from './SidebarFavorites';
import SidebarResizeHandle from './SidebarResizeHandle';
import SidebarRecents from './SidebarRecents';
import SidebarSection from './SidebarSection';
import SidebarSettingsNav from './SidebarSettingsNav';
import { SidebarListSkeleton } from './Skeleton';
import SidebarArchive, { computeSidebarArchiveRoots } from './SidebarArchive';
import SidebarTrash, { computeSidebarTrashRoots } from './SidebarTrash';
import ThemeToggle from './ThemeToggle';
import {
	computeDocumentUri,
	isSettingsUri,
	parseIdFromUri,
	parseSplatUri,
	SETTINGS_URI,
} from '../router/useResolveEntity';
import { DOCUMENT_POST_TYPE, FULL_PAGE_COLLECTION_QUERY } from '../collections';
import useDelayedFlag, {
	SKELETON_MIN_VISIBLE_MS,
} from '../hooks/useDelayedFlag';
import { useFavorites } from '../hooks/useFavorites';
import useSidebarSections from '../hooks/useSidebarSections';
import useArchivedDocuments from '../hooks/useArchivedDocuments';
import useTrashedDocuments from '../hooks/useTrashedDocuments';
import { useWorkspaceHome } from '../hooks/useWorkspaceHome';
import {
	DocumentsProvider,
	favoriteIdentForRecord,
	favoriteKey,
	favoriteKeyForRecord,
	useCreateCollectionDocument,
	useCreateDocument,
	useDocumentSelection,
	useFavoriteToggle,
} from '../documents';
import useSidebarDnd from './sidebar/useSidebarDnd';
import useSidebarNavigation from './sidebar/useSidebarNavigation';
import useSidebarTree, { ROOT_PARENT_ID } from './sidebar/useSidebarTree';
import DocumentRow from './sidebar/DocumentRow';
import { isWordPressAffordancesEnabled } from '../settings';
import { useSurfaceFocusIntent } from './SurfaceFocusContext';
import useLifecycleTabFocusIntent from './useLifecycleTabFocusIntent';

export default function Sidebar( {
	collapsed = false,
	width,
	onToggleCollapsed,
	onWidthChange,
} ) {
	// Favorites still needs collection labels. The Documents tree below loads
	// lazily through useSidebarTree.
	const { records: collections, isResolving: isResolvingCollections } =
		useEntityRecords(
			'postType',
			DOCUMENT_POST_TYPE,
			FULL_PAGE_COLLECTION_QUERY
		);
	const trashedDocumentsState = useTrashedDocuments();
	const archivedDocumentsState = useArchivedDocuments();
	const archivedDocumentIds = useMemo(
		() =>
			new Set(
				( archivedDocumentsState.documents ?? [] )
					.map( ( document ) => Number( document.id ) )
					.filter( Boolean )
			),
		[ archivedDocumentsState.documents ]
	);
	const params = useParams( { strict: false } );
	const routeUri = params._splat ?? '';
	const { prefix: routePrefix, tail: routeTail } = useMemo(
		() => parseSplatUri( routeUri ),
		[ routeUri ]
	);
	const routeSelectedId = useMemo(
		() =>
			routePrefix === 'page' || routePrefix === null
				? parseIdFromUri( routeTail )
				: null,
		[ routePrefix, routeTail ]
	);
	const routeSelectedCollectionId = useMemo(
		() =>
			routePrefix === 'collection' ? parseIdFromUri( routeTail ) : null,
		[ routePrefix, routeTail ]
	);
	const {
		home,
		setHome,
		isResolving: isResolvingHome,
		isUpdating: isHomeUpdating,
	} = useWorkspaceHome();
	const {
		favorites,
		setFavorites,
		isResolving: isResolvingFavorites,
	} = useFavorites();
	const { saveEntityRecord } = useDispatch( 'core' );
	const {
		tree,
		pages,
		rootBranch,
		isResolvingPages,
		expandedIds,
		toggleExpand,
		expand,
		loadBranch,
		loadMore,
		refreshBranch,
		getBranch,
	} = useSidebarTree( {
		selectedId: routeSelectedId,
		selectedCollectionId: routeSelectedCollectionId,
	} );
	const fallbackHomePage = tree[ 0 ]?.page ?? null;
	const homePath =
		home?.path ??
		( fallbackHomePage ? computeDocumentUri( fallbackHomePage ) : null );
	const isResolvingHomePath =
		isResolvingHome || ( ! home?.path && isResolvingPages );
	const showPagesSkeleton = useDelayedFlag(
		isResolvingPages && pages.length === 0,
		120,
		SKELETON_MIN_VISIBLE_MS
	);
	const { navigate, selectedId, selectedCollectionId, onSelect, goHome } =
		useSidebarNavigation( { pages, homePath } );
	const { requestFromActivation } = useSurfaceFocusIntent();
	const homeDocumentId = home?.id ?? fallbackHomePage?.id ?? null;
	const openHome = useCallback(
		( event ) => {
			requestFromActivation( event, homeDocumentId );
			goHome();
		},
		[ goHome, homeDocumentId, requestFromActivation ]
	);
	const { isSelected: isRowSelected, selectRecord: onRowSelect } =
		useDocumentSelection( { selectedId, selectedCollectionId } );
	const adminUrl = window.cortextSettings?.adminUrl ?? '/wp-admin/';
	const brandIconUrl = window.cortextSettings?.iconUrl ?? '';
	const wordpressAffordances = isWordPressAffordancesEnabled();
	const commandPaletteShortcut = displayShortcut.primary( 'k' );
	const brandLabel = __( 'Cortext', 'cortext' );
	const isSettingsMode = isSettingsUri( routeUri );

	const [ favoritesError, setFavoritesError ] = useState( null );
	const [ duplicateNotice, setDuplicateNotice ] = useState( null );
	const [ settingsReturnUri, setSettingsReturnUri ] = useState( null );
	const {
		isFavorite,
		toggle: toggleFavorite,
		disabled: areFavoriteActionsDisabled,
	} = useFavoriteToggle( { onError: setFavoritesError } );
	const { isSectionCollapsed, toggleSection } = useSidebarSections();
	const openSettings = useCallback( () => {
		if ( isSettingsMode ) {
			return;
		}
		setSettingsReturnUri( routeUri );
		navigate( {
			to: '/$',
			params: { _splat: SETTINGS_URI },
		} );
	}, [ isSettingsMode, navigate, routeUri ] );
	const closeSettings = useCallback( () => {
		const returnUri = settingsReturnUri;
		setSettingsReturnUri( null );
		if ( returnUri ) {
			navigate( {
				to: '/$',
				params: { _splat: returnUri },
			} );
			return;
		}
		navigate( { to: '/' } );
	}, [ navigate, settingsReturnUri ] );
	const toggleTrashPanel = useCallback( () => {
		if ( collapsed ) {
			setIsTrashPanelOpen( true );
			onToggleCollapsed?.();
			return;
		}
		setIsTrashPanelOpen( ( current ) => ! current );
	}, [ collapsed, onToggleCollapsed ] );

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
			// Use `isRowSelected` as the shared selected-state check. Post IDs
			// are globally unique, so the same id cannot point at two documents.
			if ( isRowSelected( favorite ) ) {
				return false;
			}
			navigate( {
				to: '/$',
				params: { _splat: favorite.path },
			} );
			return true;
		},
		[ isRowSelected, navigate ]
	);

	// `draggedId` and `activeDrop` flow into the per-row callbacks below, so
	// the DnD hook has to resolve before any `useCallback` that lists them as
	// deps. Otherwise their `const` bindings sit in the temporal dead zone
	// when the callback's dep array is evaluated and React throws on render.
	const { sensors, draggedId, draggedPage, activeDrop, handlers } =
		useSidebarDnd( {
			pages,
			expandedIds,
			expand,
			loadBranch,
			refreshBranch,
			getBranch,
			saveEntityRecord,
		} );

	const [ autoRenameId, setAutoRenameId ] = useState( null );
	const [ isTrashPanelOpen, setIsTrashPanelOpen ] = useState( false );
	const [ lifecycleTab, setLifecycleTab ] = useState( 'archived' );
	const archiveTabRef = useRef( null );
	const trashTabRef = useRef( null );
	const pendingLifecycleTabFocusRef = useRef( null );
	const [ lifecycleTabFocusRequest, setLifecycleTabFocusRequest ] =
		useState( 0 );
	const {
		capture: captureLifecycleFocusIntent,
		consume: consumeLifecycleFocusIntent,
		cancel: cancelLifecycleFocusIntent,
	} = useLifecycleTabFocusIntent();
	const openAndFocusLifecycleTab = useCallback( ( nextTab, focusIntent ) => {
		pendingLifecycleTabFocusRef.current = focusIntent
			? { tab: nextTab, focusIntent }
			: null;
		setLifecycleTab( nextTab );
		setIsTrashPanelOpen( true );
		if ( focusIntent ) {
			setLifecycleTabFocusRequest( ( current ) => current + 1 );
		}
	}, [] );
	useEffect( () => {
		const pendingRequest = pendingLifecycleTabFocusRef.current;
		if ( ! isTrashPanelOpen || pendingRequest?.tab !== lifecycleTab ) {
			return;
		}
		const tabRef =
			pendingRequest.tab === 'archived' ? archiveTabRef : trashTabRef;
		if ( ! tabRef.current ) {
			return;
		}
		pendingLifecycleTabFocusRef.current = null;
		if ( ! consumeLifecycleFocusIntent( pendingRequest.focusIntent ) ) {
			return;
		}
		tabRef.current.focus();
	}, [
		consumeLifecycleFocusIntent,
		isTrashPanelOpen,
		lifecycleTab,
		lifecycleTabFocusRequest,
	] );
	const onLifecycleTabKeyDown = useCallback(
		( event ) => {
			let nextTab = null;
			if ( event.key === 'ArrowLeft' || event.key === 'ArrowRight' ) {
				nextTab = lifecycleTab === 'archived' ? 'trash' : 'archived';
			} else if ( event.key === 'Home' ) {
				nextTab = 'archived';
			} else if ( event.key === 'End' ) {
				nextTab = 'trash';
			}
			if ( ! nextTab ) {
				return;
			}
			event.preventDefault();
			setLifecycleTab( nextTab );
			const nextRef =
				nextTab === 'archived' ? archiveTabRef : trashTabRef;
			nextRef.current?.focus();
		},
		[ lifecycleTab ]
	);
	const archiveCount = useMemo( () => {
		if ( Array.isArray( archivedDocumentsState.documents ) ) {
			return computeSidebarArchiveRoots(
				archivedDocumentsState.documents
			).roots.length;
		}
		return archivedDocumentsState.total;
	}, [ archivedDocumentsState.documents, archivedDocumentsState.total ] );
	const trashCount = useMemo( () => {
		if ( Array.isArray( trashedDocumentsState.documents ) ) {
			return computeSidebarTrashRoots( trashedDocumentsState.documents )
				.roots.length;
		}
		return trashedDocumentsState.total;
	}, [ trashedDocumentsState.documents, trashedDocumentsState.total ] );
	const lifecycleCount = archiveCount + trashCount;
	let trashButtonLabel = __( 'Open Archived and Trash', 'cortext' );
	if ( isTrashPanelOpen ) {
		trashButtonLabel = __( 'Close Archived and Trash', 'cortext' );
	} else if ( lifecycleCount > 0 ) {
		trashButtonLabel = sprintf(
			/* translators: %d: number of archived and trashed documents */
			_n(
				'Open Archived and Trash, %d item',
				'Open Archived and Trash, %d items',
				lifecycleCount,
				'cortext'
			),
			lifecycleCount
		);
	}

	useEffect( () => {
		if ( collapsed ) {
			setIsTrashPanelOpen( false );
		}
	}, [ collapsed ] );

	useEffect( () => {
		if ( ! isSettingsMode ) {
			return;
		}

		const handleKeyDown = ( event ) => {
			if ( event.key !== 'Escape' || event.defaultPrevented ) {
				return;
			}

			const target = event.target;
			const targetElement =
				target instanceof window.HTMLElement ? target : null;
			if (
				targetElement?.isContentEditable ||
				targetElement?.closest( 'input, textarea, select' )
			) {
				return;
			}

			closeSettings();
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ closeSettings, isSettingsMode ] );

	// --- Per-row selection helpers --------------------------------------

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

	// Wire callbacks that `useDocumentActions` needs from document rows and
	// lifecycle panels. Create goes through `useCreateDocument`
	// at the top of Sidebar and bypasses the provider.
	const documentsHandlers = useMemo(
		() => ( {
			selectedCollectionId,
			expand,
			onSelect,
			onAutoRename: ( target ) => setAutoRenameId( target?.id ?? null ),
			captureLifecycleFocusIntent,
			cancelLifecycleFocusIntent,
			onAfterTrash: ( { lifecycleFocusIntent } = {} ) =>
				openAndFocusLifecycleTab( 'trash', lifecycleFocusIntent ),
			onAfterArchive: ( { lifecycleFocusIntent } = {} ) =>
				openAndFocusLifecycleTab( 'archived', lifecycleFocusIntent ),
			onDuplicateNotice: setDuplicateNotice,
			onFavoritesError: setFavoritesError,
		} ),
		[
			selectedCollectionId,
			expand,
			onSelect,
			captureLifecycleFocusIntent,
			cancelLifecycleFocusIntent,
			openAndFocusLifecycleTab,
		]
	);

	const create = useCreateDocument();
	const createCollection = useCreateCollectionDocument();
	// After creating a page or collection, open it and put its sidebar row into
	// rename mode.
	const openAfterCreate = useCallback(
		( created ) => {
			if ( created?.id ) {
				setAutoRenameId( created.id );
				navigate( {
					to: '/$',
					params: { _splat: computeDocumentUri( created ) },
				} );
			}
			return created;
		},
		[ navigate ]
	);
	const createAndOpen = useCallback(
		async ( input ) => {
			const created = await create( input );
			refreshBranch( created?.parent ?? input?.parent ?? ROOT_PARENT_ID );
			return openAfterCreate( created );
		},
		[ create, openAfterCreate, refreshBranch ]
	);
	const createCollectionAndOpen = useCallback(
		async ( input ) => {
			const created = await createCollection( input );
			refreshBranch( created?.parent ?? input?.parent ?? ROOT_PARENT_ID );
			return openAfterCreate( created );
		},
		[ createCollection, openAfterCreate, refreshBranch ]
	);
	const createRootPage = useCallback(
		() => createAndOpen( {} ),
		[ createAndOpen ]
	);
	const createRootCollection = useCallback(
		() => createCollectionAndOpen( {} ),
		[ createCollectionAndOpen ]
	);
	const createChildPage = useCallback(
		( parentId ) => createAndOpen( { parent: parentId } ),
		[ createAndOpen ]
	);
	const createChildCollection = useCallback(
		( parentId ) => createCollectionAndOpen( { parent: parentId } ),
		[ createCollectionAndOpen ]
	);

	// Props shared by every DocumentRow in the Pages tree.
	const rowChrome = {
		expandedIds,
		draggedId,
		activeDrop,
		isSelected: isRowSelected,
		onSelect: onRowSelect,
		onToggleExpand: toggleExpand,
		onLoadMore: loadMore,
		isFavorite,
		isFavoriteDisabled: areFavoriteActionsDisabled,
		onToggleFavorite: toggleFavorite,
		isHome: isRowHome,
		onSetHome: onSetRowHome,
		isHomeUpdating,
		autoRenameId,
		onAutoRenameConsumed: () => setAutoRenameId( null ),
		onCreateChild: createChildPage,
		onCreateChildCollection: createChildCollection,
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
							{ brandIconUrl ? (
								<img
									className="cortext-sidebar__brand-image"
									src={ brandIconUrl }
									alt=""
								/>
							) : (
								<span className="cortext-sidebar__brand-initial">
									C
								</span>
							) }
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
				className="cortext-sidebar__views"
				data-settings={ isSettingsMode ? 'true' : 'false' }
			>
				<div
					className="cortext-sidebar__view cortext-sidebar__view--main"
					aria-hidden={ isSettingsMode }
					{ ...( isSettingsMode ? { inert: '' } : {} ) }
				>
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
										{ __(
											'Search or run a command',
											'cortext'
										) }
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
							onClick={ openHome }
						>
							<Icon icon={ homeIcon } size={ 16 } />
							{ ! collapsed && (
								<span>{ __( 'Home', 'cortext' ) }</span>
							) }
						</Button>
					</div>
					{ ! collapsed && (
						<DocumentsProvider { ...documentsHandlers }>
							<div className="cortext-sidebar__content">
								{ favoritesError ? (
									<Notice
										status="error"
										onRemove={ () =>
											setFavoritesError( null )
										}
									>
										{ favoritesError }
									</Notice>
								) : null }
								{ duplicateNotice ? (
									<Notice
										status="warning"
										onRemove={ () =>
											setDuplicateNotice( null )
										}
									>
										{ duplicateNotice }
									</Notice>
								) : null }
								<SidebarSection
									id="recents"
									title={ __( 'Recents', 'cortext' ) }
									isCollapsed={ isSectionCollapsed(
										'recents'
									) }
									onToggle={ () =>
										toggleSection( 'recents' )
									}
								>
									<SidebarRecents
										hiddenDocumentIds={
											archivedDocumentIds
										}
									/>
								</SidebarSection>

								<SidebarSection
									id="favorites"
									title={ __( 'Favorites', 'cortext' ) }
									isCollapsed={ isSectionCollapsed(
										'favorites'
									) }
									onToggle={ () =>
										toggleSection( 'favorites' )
									}
								>
									<SidebarFavorites
										favorites={ favorites }
										hiddenDocumentIds={
											archivedDocumentIds
										}
										pages={ pages }
										collections={ collections ?? [] }
										isResolving={ isResolvingFavorites }
										isResolvingItems={
											isResolvingPages ||
											isResolvingCollections
										}
										isDisabled={
											areFavoriteActionsDisabled
										}
										onSelect={ selectFavorite }
										onRemove={ toggleFavorite }
										onReorder={ reorderFavorites }
									/>
								</SidebarSection>

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
										title={ __( 'Documents', 'cortext' ) }
										isCollapsed={ isSectionCollapsed(
											'pages'
										) }
										onToggle={ () =>
											toggleSection( 'pages' )
										}
										actions={
											<div className="cortext-sidebar__split-action">
												<Button
													className="cortext-sidebar__section-action cortext-sidebar__split-action-primary"
													icon={ plus }
													size="small"
													label={ __(
														'New document',
														'cortext'
													) }
													onClick={ createRootPage }
												/>
												<Dropdown
													contentClassName="cortext-sidebar__create-menu"
													popoverProps={ {
														placement: 'bottom-end',
													} }
													renderToggle={ ( {
														isOpen,
														onToggle,
													} ) => (
														<Button
															className="cortext-sidebar__section-action cortext-sidebar__split-action-toggle"
															icon={ chevronDown }
															size="small"
															label={ __(
																'Create a document or collection',
																'cortext'
															) }
															onClick={ onToggle }
															isPressed={ isOpen }
															aria-expanded={
																isOpen
															}
														/>
													) }
													renderContent={ ( {
														onClose,
													} ) => (
														<MenuGroup>
															<MenuItem
																icon={ page }
																onClick={ () => {
																	createRootPage();
																	onClose();
																} }
															>
																{ __(
																	'New document',
																	'cortext'
																) }
															</MenuItem>
															<MenuItem
																icon={
																	collectionIcon
																}
																onClick={ () => {
																	createRootCollection();
																	onClose();
																} }
															>
																{ __(
																	'New collection',
																	'cortext'
																) }
															</MenuItem>
														</MenuGroup>
													) }
												/>
											</div>
										}
									>
										{ isResolvingPages &&
											pages.length === 0 &&
											showPagesSkeleton && (
												<SidebarListSkeleton
													itemCount={ 1 }
												/>
											) }
										{ ! isResolvingPages &&
											pages.length === 0 && (
												<p className="cortext-sidebar__empty">
													{ __(
														'Nothing here yet.',
														'cortext'
													) }
												</p>
											) }
										{ rootBranch.error && (
											<p
												className="cortext-sidebar__row-error"
												role="alert"
											>
												{ __(
													"We couldn't load these documents.",
													'cortext'
												) }
											</p>
										) }

										<ul className="cortext-sidebar__list">
											{ tree.map( ( node ) => (
												<DocumentRow
													key={ node.page.id }
													record={ node.page }
													childNodes={ node.children }
													childBranch={ node.branch }
													depth={ 0 }
													{ ...rowChrome }
												/>
											) ) }
											{ rootBranch.hasResolved &&
												rootBranch.page <
													rootBranch.totalPages && (
													<li
														className="cortext-sidebar__node cortext-sidebar__load-more-node"
														style={ {
															'--cortext-depth': 0,
														} }
													>
														<Button
															className="cortext-sidebar__load-more"
															size="compact"
															isBusy={
																rootBranch.isLoading
															}
															disabled={
																rootBranch.isLoading
															}
															onClick={ () =>
																loadMore(
																	ROOT_PARENT_ID
																)
															}
														>
															{ __(
																'Show more',
																'cortext'
															) }
														</Button>
													</li>
												) }
										</ul>
									</SidebarSection>

									<DragOverlay>
										{ draggedPage ? (
											<div className="cortext-sidebar__drag-preview">
												{ draggedPage.title?.rendered?.trim() ||
													__(
														'(untitled)',
														'cortext'
													) }
											</div>
										) : null }
									</DragOverlay>
								</DndContext>
							</div>
							{ isTrashPanelOpen && (
								<section
									id="cortext-sidebar-trash-panel"
									className="cortext-sidebar__trash-panel"
									aria-label={ __(
										'Archived and Trash',
										'cortext'
									) }
								>
									<div
										className="cortext-sidebar__trash-panel-tabs"
										role="tablist"
										aria-label={ __(
											'Document lifecycle',
											'cortext'
										) }
									>
										<Button
											ref={ archiveTabRef }
											id="cortext-sidebar-archived-tab"
											className="cortext-sidebar__trash-panel-tab"
											role="tab"
											aria-selected={
												lifecycleTab === 'archived'
											}
											aria-controls="cortext-sidebar-archived-tabpanel"
											tabIndex={
												lifecycleTab === 'archived'
													? 0
													: -1
											}
											onKeyDown={ onLifecycleTabKeyDown }
											onClick={ () =>
												setLifecycleTab( 'archived' )
											}
										>
											{ __( 'Archived', 'cortext' ) }
											{ archiveCount > 0 && (
												<span aria-hidden="true">
													{ archiveCount }
												</span>
											) }
										</Button>
										<Button
											ref={ trashTabRef }
											id="cortext-sidebar-trash-tab"
											className="cortext-sidebar__trash-panel-tab"
											role="tab"
											aria-selected={
												lifecycleTab === 'trash'
											}
											aria-controls="cortext-sidebar-trash-tabpanel"
											tabIndex={
												lifecycleTab === 'trash'
													? 0
													: -1
											}
											onKeyDown={ onLifecycleTabKeyDown }
											onClick={ () =>
												setLifecycleTab( 'trash' )
											}
										>
											{ __( 'Trash', 'cortext' ) }
											{ trashCount > 0 && (
												<span aria-hidden="true">
													{ trashCount }
												</span>
											) }
										</Button>
									</div>
									<div
										id="cortext-sidebar-archived-tabpanel"
										role="tabpanel"
										aria-labelledby="cortext-sidebar-archived-tab"
										hidden={ lifecycleTab !== 'archived' }
									>
										<SidebarArchive
											activePages={ pages }
											selectedId={ selectedId }
											selectedCollectionId={
												selectedCollectionId
											}
											archivedDocumentsState={
												archivedDocumentsState
											}
										/>
									</div>
									<div
										id="cortext-sidebar-trash-tabpanel"
										role="tabpanel"
										aria-labelledby="cortext-sidebar-trash-tab"
										hidden={ lifecycleTab !== 'trash' }
									>
										<SidebarTrash
											activePages={ pages }
											selectedId={ selectedId }
											selectedCollectionId={
												selectedCollectionId
											}
											onSelect={ onSelect }
											trashedDocumentsState={
												trashedDocumentsState
											}
										/>
									</div>
								</section>
							) }
						</DocumentsProvider>
					) }
					<div className="cortext-sidebar__footer">
						<div className="cortext-sidebar__footer-group cortext-sidebar__footer-group--navigation">
							<Button
								className="cortext-sidebar__footer-button cortext-sidebar__trash-footer"
								label={ trashButtonLabel }
								aria-expanded={
									! collapsed && isTrashPanelOpen
								}
								aria-controls="cortext-sidebar-trash-panel"
								isPressed={ ! collapsed && isTrashPanelOpen }
								onClick={ toggleTrashPanel }
							>
								<Icon icon={ archiveIcon } size={ 20 } />
								{ lifecycleCount > 0 && (
									<span
										className="cortext-sidebar__footer-count"
										aria-hidden="true"
									>
										{ lifecycleCount > 99
											? '99+'
											: lifecycleCount }
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
							<Button
								className="cortext-sidebar__footer-button cortext-sidebar__settings-toggle"
								label={ __( 'Settings', 'cortext' ) }
								isPressed={ isSettingsMode }
								onClick={ openSettings }
							>
								<Icon icon={ cog } size={ 20 } />
							</Button>
							<ThemeToggle />
							{ wordpressAffordances ? (
								<Button
									className="cortext-sidebar__back"
									label={ __( 'Go to WordPress', 'cortext' ) }
									href={ adminUrl }
									icon={
										<Icon icon={ wordpress } size={ 24 } />
									}
								/>
							) : null }
						</div>
					</div>
				</div>
				<div
					className="cortext-sidebar__view cortext-sidebar__view--settings"
					aria-hidden={ ! isSettingsMode }
					{ ...( isSettingsMode ? {} : { inert: '' } ) }
				>
					<SidebarSettingsNav
						collapsed={ collapsed }
						onBack={ closeSettings }
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
