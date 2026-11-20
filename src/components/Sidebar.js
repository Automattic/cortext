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
import computeCascadeRoots from './computeCascadeRoots';
import LifecycleSidebar from './lifecycle/LifecycleSidebar';
import { ARCHIVED, TRASH } from './lifecycle/lifecycleStates';
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
	// Trash and Archived take over the sidebar like Settings does.
	const lifecycleState =
		[ TRASH, ARCHIVED ].find( ( state ) => state.isUri( routeUri ) ) ??
		null;
	let sidebarMode = 'main';
	if ( isSettingsMode ) {
		sidebarMode = 'settings';
	} else if ( lifecycleState ) {
		sidebarMode = lifecycleState.name;
	}
	const lifecycleSelectedId = lifecycleState
		? Number( parseSplatUri( routeUri ).tail ) || null
		: null;

	const [ favoritesError, setFavoritesError ] = useState( null );
	const [ duplicateNotice, setDuplicateNotice ] = useState( null );
	const [ createError, setCreateError ] = useState( null );
	const [ settingsReturnUri, setSettingsReturnUri ] = useState( null );
	const [ lifecycleReturnUri, setLifecycleReturnUri ] = useState( null );
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
	// Back returns to where the first lifecycle view was opened from, even
	// after switching from Trash to Archived or the other way around.
	const openLifecycle = useCallback(
		( state ) => {
			if ( lifecycleState === state ) {
				return;
			}
			if ( collapsed ) {
				onToggleCollapsed?.();
			}
			if ( ! lifecycleState ) {
				setLifecycleReturnUri( isSettingsMode ? null : routeUri );
			}
			navigate( { to: '/$', params: { _splat: state.uri() } } );
		},
		[
			collapsed,
			isSettingsMode,
			lifecycleState,
			navigate,
			onToggleCollapsed,
			routeUri,
		]
	);
	const closeLifecycle = useCallback( () => {
		const returnUri = lifecycleReturnUri;
		setLifecycleReturnUri( null );
		if ( returnUri ) {
			navigate( { to: '/$', params: { _splat: returnUri } } );
			return;
		}
		navigate( { to: '/' } );
	}, [ lifecycleReturnUri, navigate ] );

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
	const archivedFooterRef = useRef( null );
	const trashFooterRef = useRef( null );
	const {
		capture: captureLifecycleFocusIntent,
		consume: consumeLifecycleFocusIntent,
		cancel: cancelLifecycleFocusIntent,
	} = useLifecycleTabFocusIntent();
	// A document trashed or archived from the keyboard leaves the tree, so
	// focus lands on the footer button of the view it went to instead of
	// falling back to the page.
	const focusFooterAfter = useCallback(
		( footerRef, focusIntent ) => {
			if ( consumeLifecycleFocusIntent( focusIntent ) ) {
				footerRef.current?.focus();
			}
		},
		[ consumeLifecycleFocusIntent ]
	);
	const documentsStateByName = {
		[ TRASH.name ]: trashedDocumentsState,
		[ ARCHIVED.name ]: archivedDocumentsState,
	};
	const archivedCount = useLifecycleRootCount(
		ARCHIVED,
		archivedDocumentsState
	);
	const trashCount = useLifecycleRootCount( TRASH, trashedDocumentsState );
	const archivedButtonLabel =
		archivedCount > 0
			? sprintf(
					/* translators: %d: number of archived items */
					_n(
						'Archived, %d item',
						'Archived, %d items',
						archivedCount,
						'cortext'
					),
					archivedCount
			  )
			: __( 'Archived', 'cortext' );
	const trashButtonLabel =
		trashCount > 0
			? sprintf(
					/* translators: %d: number of items in Trash */
					_n(
						'Trash, %d item',
						'Trash, %d items',
						trashCount,
						'cortext'
					),
					trashCount
			  )
			: __( 'Trash', 'cortext' );

	// Escape leaves Settings, Trash or Archived, the views that take over the
	// sidebar.
	let closeOverlayMode = null;
	if ( isSettingsMode ) {
		closeOverlayMode = closeSettings;
	} else if ( lifecycleState ) {
		closeOverlayMode = closeLifecycle;
	}
	useEffect( () => {
		if ( ! closeOverlayMode ) {
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

			closeOverlayMode();
		};

		window.addEventListener( 'keydown', handleKeyDown );
		return () => {
			window.removeEventListener( 'keydown', handleKeyDown );
		};
	}, [ closeOverlayMode ] );

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
	// lifecycle views. Create goes through `useCreateDocument`
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
				focusFooterAfter( trashFooterRef, lifecycleFocusIntent ),
			onAfterArchive: ( { lifecycleFocusIntent } = {} ) =>
				focusFooterAfter( archivedFooterRef, lifecycleFocusIntent ),
			onDuplicateNotice: setDuplicateNotice,
			onFavoritesError: setFavoritesError,
		} ),
		[
			selectedCollectionId,
			expand,
			onSelect,
			captureLifecycleFocusIntent,
			cancelLifecycleFocusIntent,
			focusFooterAfter,
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
	const createAndOpenWith = useCallback(
		async ( createFn, input, fallbackMessage ) => {
			setCreateError( null );
			try {
				const created = await createFn( input );
				refreshBranch(
					created?.parent ?? input?.parent ?? ROOT_PARENT_ID
				);
				return openAfterCreate( created );
			} catch ( error ) {
				setCreateError( error?.message ?? fallbackMessage );
				return null;
			}
		},
		[ openAfterCreate, refreshBranch ]
	);
	const createAndOpen = useCallback(
		( input ) =>
			createAndOpenWith(
				create,
				input,
				__( 'Could not create a document.', 'cortext' )
			),
		[ create, createAndOpenWith ]
	);
	const createCollectionAndOpen = useCallback(
		( input ) =>
			createAndOpenWith(
				createCollection,
				input,
				__( 'Collection could not be created.', 'cortext' )
			),
		[ createCollection, createAndOpenWith ]
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
			<div className="cortext-sidebar__views" data-mode={ sidebarMode }>
				<div
					className="cortext-sidebar__view cortext-sidebar__view--main"
					aria-hidden={ sidebarMode !== 'main' }
					{ ...( sidebarMode !== 'main' ? { inert: '' } : {} ) }
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
								{ createError ? (
									<Notice
										status="error"
										onRemove={ () =>
											setCreateError( null )
										}
									>
										{ createError }
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
						</DocumentsProvider>
					) }
					<div className="cortext-sidebar__footer">
						<div className="cortext-sidebar__footer-group cortext-sidebar__footer-group--navigation">
							{ [
								{
									state: ARCHIVED,
									ref: archivedFooterRef,
									className:
										'cortext-sidebar__archive-footer',
									label: archivedButtonLabel,
								},
								{
									state: TRASH,
									ref: trashFooterRef,
									className: 'cortext-sidebar__trash-footer',
									label: trashButtonLabel,
								},
							].map( ( footer ) => (
								<Button
									key={ footer.state.name }
									ref={ footer.ref }
									className={ `cortext-sidebar__footer-button ${ footer.className }` }
									label={ footer.label }
									isPressed={
										lifecycleState === footer.state
									}
									onClick={ () =>
										openLifecycle( footer.state )
									}
								>
									<Icon
										icon={ footer.state.icon }
										size={ 20 }
									/>
								</Button>
							) ) }
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
				<div
					className="cortext-sidebar__view cortext-sidebar__view--lifecycle"
					aria-hidden={ ! lifecycleState }
					{ ...( lifecycleState ? {} : { inert: '' } ) }
				>
					{ lifecycleState && (
						<LifecycleSidebar
							state={ lifecycleState }
							collapsed={ collapsed }
							onBack={ closeLifecycle }
							documentsState={
								documentsStateByName[ lifecycleState.name ]
							}
							selectedId={ lifecycleSelectedId }
						/>
					) }
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

// How many items a lifecycle view lists: its cascade roots, or the server's
// total before the documents load.
function useLifecycleRootCount( state, documentsState ) {
	const { documents, total } = documentsState;
	return useMemo(
		() =>
			Array.isArray( documents )
				? computeCascadeRoots( documents, state.markerKeys ).roots
						.length
				: total,
		[ documents, state.markerKeys, total ]
	);
}
