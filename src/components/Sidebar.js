import { __, _n, sprintf } from '@wordpress/i18n';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { useState, useMemo, useCallback, useEffect } from '@wordpress/element';
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
	globe,
	home as homeIcon,
	page,
	plus,
	search,
	table,
	trash as trashIcon,
	upload,
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
import SidebarFavorites from './SidebarFavorites';
import SidebarResizeHandle from './SidebarResizeHandle';
import SidebarRecents from './SidebarRecents';
import SidebarSection from './SidebarSection';
import { SidebarListSkeleton } from './Skeleton';
import SidebarTrash, { computeSidebarTrashRoots } from './SidebarTrash';
import ThemeToggle from './ThemeToggle';
import {
	computeDocumentUri,
	IMPORT_URI,
	PUBLISHED_DOCUMENTS_URI,
} from '../router/useResolveEntity';
import { DOCUMENT_POST_TYPE, FULL_PAGE_COLLECTION_QUERY } from '../collections';
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
	favoriteKey,
	favoriteKeyForRecord,
	useCreateCollectionDocument,
	useCreateDocument,
	useDocumentSelection,
	useFavoriteToggle,
} from '../documents';
import useSidebarDnd from './sidebar/useSidebarDnd';
import useSidebarNavigation from './sidebar/useSidebarNavigation';
import useSidebarTree from './sidebar/useSidebarTree';
import DocumentRow from './sidebar/DocumentRow';
import {
	isPublicWebAffordancesEnabled,
	isWordPressAffordancesEnabled,
} from '../settings';

export default function Sidebar( {
	collapsed = false,
	width,
	onToggleCollapsed,
	onWidthChange,
} ) {
	// tech-debt.md#td-workspace-tree-no-unified-model: this tree still comes from flat REST lists capped at
	// `per_page: 100`. The follow-up is lazy loading or a paged tree endpoint.
	const { records: collections, isResolving: isResolvingCollections } =
		useEntityRecords(
			'postType',
			DOCUMENT_POST_TYPE,
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
	} = useFavorites();
	const { saveEntityRecord } = useDispatch( 'core' );
	const {
		navigate,
		activeUri,
		selectedId,
		selectedCollectionId,
		onSelect,
		goHome,
	} = useSidebarNavigation( { pages, homePath } );
	const { isSelected: isRowSelected, selectRecord: onRowSelect } =
		useDocumentSelection( { selectedId, selectedCollectionId } );
	const adminUrl = window.cortextSettings?.adminUrl ?? '/wp-admin/';
	const userName = window.cortextSettings?.userDisplayName ?? '';
	const publicWebAffordances = isPublicWebAffordancesEnabled();
	const wordpressAffordances = isWordPressAffordancesEnabled();
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
	const {
		isFavorite,
		toggle: toggleFavorite,
		disabled: areFavoriteActionsDisabled,
	} = useFavoriteToggle( { onError: setFavoritesError } );
	const { isSectionCollapsed, toggleSection } = useSidebarSections();
	const goPublished = useCallback( () => {
		navigate( {
			to: '/$',
			params: { _splat: PUBLISHED_DOCUMENTS_URI },
		} );
	}, [ navigate ] );
	const isPublishedActive =
		publicWebAffordances && activeUri === PUBLISHED_DOCUMENTS_URI;
	const goImport = useCallback( () => {
		navigate( {
			to: '/$',
			params: { _splat: IMPORT_URI },
		} );
	}, [ navigate ] );
	const isImportActive = activeUri === IMPORT_URI;
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

	// The tree is built from one non-row document list (pages and collections).
	// The `collections` query feeds only the Favorites label lookup.
	const { tree, expandedIds, toggleExpand, expand } = useSidebarTree( {
		documents: pages,
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
			expandedIds,
			expand,
			saveEntityRecord,
		} );

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

	// Wire callbacks that `useDocumentActions` needs (rename, trash, duplicate)
	// from DocumentRow / SidebarTrash. Create goes through `useCreateDocument`
	// at the top of Sidebar and bypasses the provider.
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
		async ( input ) => openAfterCreate( await create( input ) ),
		[ create, openAfterCreate ]
	);
	const createCollectionAndOpen = useCallback(
		async ( input ) => openAfterCreate( await createCollection( input ) ),
		[ createCollection, openAfterCreate ]
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
				{ publicWebAffordances ? (
					<Button
						className="cortext-sidebar__quick-action cortext-sidebar__quick-action--published"
						label={ __( 'Published', 'cortext' ) }
						isPressed={ isPublishedActive }
						onClick={ goPublished }
					>
						<Icon icon={ globe } size={ 16 } />
						{ ! collapsed && (
							<span>{ __( 'Published', 'cortext' ) }</span>
						) }
					</Button>
				) : null }
				<Button
					className="cortext-sidebar__quick-action cortext-sidebar__quick-action--import"
					label={ __( 'Import', 'cortext' ) }
					isPressed={ isImportActive }
					onClick={ goImport }
				>
					<Icon icon={ upload } size={ 16 } />
					{ ! collapsed && (
						<span>{ __( 'Import', 'cortext' ) }</span>
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
								isCollapsed={ isSectionCollapsed( 'pages' ) }
								onToggle={ () => toggleSection( 'pages' ) }
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
													aria-expanded={ isOpen }
												/>
											) }
											renderContent={ ( { onClose } ) => (
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
														icon={ table }
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
										<SidebarListSkeleton itemCount={ 5 } />
									) }
								{ ! isResolvingPages && pages.length === 0 && (
									<p className="cortext-sidebar__empty">
										{ __( 'Nothing here yet.', 'cortext' ) }
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
					{ wordpressAffordances ? (
						<Button
							className="cortext-sidebar__back"
							label={ __( 'Go to WordPress', 'cortext' ) }
							href={ adminUrl }
							icon={ <Icon icon={ wordpress } size={ 24 } /> }
						/>
					) : null }
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
