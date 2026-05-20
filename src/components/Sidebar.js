import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import {
	useState,
	useMemo,
	useRef,
	useCallback,
	useEffect,
} from '@wordpress/element';
import { Button, Icon, Notice, Spinner } from '@wordpress/components';
import { displayShortcut } from '@wordpress/keycodes';
import {
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
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	KeyboardSensor,
	useSensor,
	useSensors,
	pointerWithin,
} from '@dnd-kit/core';
import { useNavigate, useParams } from '@tanstack/react-router';

import CollectionRow from './CollectionRow';
import PageRow from './PageRow';
import { openCommandPalette } from './CommandPalette';
import SidebarFavorites, {
	favoriteKey,
	filterFavoritesForTrashedPage,
} from './SidebarFavorites';
import SidebarResizeHandle from './SidebarResizeHandle';
import SidebarRecents from './SidebarRecents';
import SidebarSection from './SidebarSection';
import SidebarTrash, { computeSidebarTrashRoots } from './SidebarTrash';
import ThemeToggle from './ThemeToggle';
import {
	buildTree,
	collectAncestorIds,
	computeDropTarget,
	isDescendantOf,
	nextChildOrder,
} from './pages-tree';
import {
	ACTIVE_PAGES_QUERY,
	POST_TYPE,
	TRASHED_PAGES_QUERY,
} from './page-queries';
import {
	computeCollectionUri,
	computeDocumentUri,
	parseIdFromUri,
	parseSplatUri,
} from '../router/useResolveEntity';
import { FULL_PAGE_COLLECTION_QUERY } from '../collections';
import { useFavorites } from '../hooks/useFavorites';
import { useRecents } from '../hooks/useRecents';
import useSidebarSections from '../hooks/useSidebarSections';
import useTrashedDocuments from '../hooks/useTrashedDocuments';
import { useWorkspaceHomePath } from '../hooks/useWorkspaceHomePath';
import { notifyDocumentTrashChanged } from '../hooks/documentTrashInvalidation';

const AUTO_EXPAND_DELAY = 700;

function parseDropId( id ) {
	if ( typeof id !== 'string' ) {
		return null;
	}
	const [ zone, rest ] = id.split( ':' );
	const pageId = Number( rest );
	if ( ! pageId || ! [ 'before', 'inside', 'after' ].includes( zone ) ) {
		return null;
	}
	return { zone, targetId: pageId };
}

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
	const {
		favorites,
		setFavorites,
		isResolving: isResolvingFavorites,
		isUpdating: isUpdatingFavorites,
	} = useFavorites();
	const { touchRecent } = useRecents();
	const { saveEntityRecord, invalidateResolution, receiveEntityRecords } =
		useDispatch( 'core' );
	const navigate = useNavigate();
	const params = useParams( { strict: false } );
	const activeUri = params._splat ?? '';
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

	const { prefix: activePrefix, tail: activeTail } = useMemo(
		() => parseSplatUri( activeUri ),
		[ activeUri ]
	);
	const selectedId = useMemo(
		() =>
			activePrefix === 'page' || activePrefix === null
				? parseIdFromUri( activeTail )
				: null,
		[ activePrefix, activeTail ]
	);
	const selectedCollectionId = useMemo(
		() =>
			activePrefix === 'collection' ? parseIdFromUri( activeTail ) : null,
		[ activePrefix, activeTail ]
	);
	const [ favoritesError, setFavoritesError ] = useState( null );
	const areFavoriteActionsDisabled =
		isResolvingFavorites || isUpdatingFavorites;
	const { isSectionCollapsed, toggleSection } = useSidebarSections();

	// Keep the URL canonical: once autosave assigns a slug to the active
	// page (draft → private promotion on first titled save), rewrite
	// `?p=/42` to `?p=/about-us-42` via history.replace so the id remains
	// authoritative while the visible URL reflects the latest title.
	useEffect( () => {
		if ( selectedId === null ) {
			return;
		}
		const current = pages.find( ( p ) => p.id === selectedId );
		if ( ! current ) {
			return;
		}
		const canonical = computeDocumentUri( current );
		if ( canonical !== activeUri ) {
			navigate( {
				to: '/$',
				params: { _splat: canonical },
				replace: true,
			} );
		}
	}, [ selectedId, pages, activeUri, navigate ] );

	// Callers that just created a record pass it as `pageHint` — after
	// `await saveEntityRecord`, React hasn't re-rendered yet, so the closure's
	// `pages` doesn't contain the new id. With id-based URLs we can build a
	// usable URL from `{ id }` alone; the slug prefix is cosmetic.
	const onSelect = useCallback(
		( id, pageHint ) => {
			if ( id === null || id === undefined ) {
				navigate( { to: '/' } );
				return;
			}
			const page = pageHint ??
				pages.find( ( p ) => p.id === id ) ?? { id };
			navigate( {
				to: '/$',
				params: { _splat: computeDocumentUri( page ) },
			} );
		},
		[ navigate, pages ]
	);
	const goHome = useCallback( () => {
		if ( ! homePath ) {
			return;
		}
		navigate( {
			to: '/$',
			params: { _splat: homePath },
		} );
	}, [ homePath, navigate ] );
	const toggleTrashPanel = useCallback( () => {
		if ( collapsed ) {
			setIsTrashPanelOpen( true );
			onToggleCollapsed?.();
			return;
		}
		setIsTrashPanelOpen( ( current ) => ! current );
	}, [ collapsed, onToggleCollapsed ] );

	const setPageHome = useCallback(
		async ( id ) => {
			try {
				await setHome( { kind: 'page', id } );
			} catch {}
		},
		[ setHome ]
	);

	const setCollectionHome = useCallback(
		async ( id ) => {
			try {
				await setHome( { kind: 'collection', id } );
			} catch {}
		},
		[ setHome ]
	);

	const favoriteKeys = useMemo(
		() =>
			new Set( favorites.map( ( favorite ) => favoriteKey( favorite ) ) ),
		[ favorites ]
	);
	const isPageFavorite = useCallback(
		( id ) => favoriteKeys.has( favoriteKey( { kind: 'page', id } ) ),
		[ favoriteKeys ]
	);
	const isCollectionFavorite = useCallback(
		( id ) => favoriteKeys.has( favoriteKey( { kind: 'collection', id } ) ),
		[ favoriteKeys ]
	);
	const toggleFavorite = useCallback(
		async ( kind, id ) => {
			if ( areFavoriteActionsDisabled ) {
				return;
			}
			const key = favoriteKey( { kind, id } );
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
						: [ ...current, { kind, id } ];
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
				( favorite.kind === 'page' && favorite.id === selectedId ) ||
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

	// tech-debt.md#53: collections with a loaded page parent appear under that
	// page. Collections with no loaded page parent stay in the Collections
	// section for now, including row-owned collections.
	const { nestedCollections, topLevelCollections } = useMemo( () => {
		const pageIds = new Set( pages.map( ( p ) => p.id ) );
		const nested = [];
		const topLevel = [];
		( collections ?? [] ).forEach( ( collection ) => {
			const parent = collection.parent ?? 0;
			if ( parent && pageIds.has( parent ) ) {
				nested.push( collection );
			} else {
				topLevel.push( collection );
			}
		} );
		return { nestedCollections: nested, topLevelCollections: topLevel };
	}, [ pages, collections ] );

	const tree = useMemo(
		() => buildTree( [ ...pages, ...nestedCollections ] ),
		[ pages, nestedCollections ]
	);

	const [ expandedIds, setExpandedIds ] = useState( () => new Set() );
	const [ draggedId, setDraggedId ] = useState( null );
	const [ activeDrop, setActiveDrop ] = useState( null );
	const [ autoRenameId, setAutoRenameId ] = useState( null );
	const [ isTrashPanelOpen, setIsTrashPanelOpen ] = useState( false );

	const renderCollectionRow = useCallback(
		( collection, depth ) => (
			<CollectionRow
				key={ collection.id }
				collection={ collection }
				depth={ depth }
				isSelected={ selectedCollectionId === collection.id }
				isHome={
					home?.kind === 'collection' && home.id === collection.id
				}
				isFavorite={ isCollectionFavorite( collection.id ) }
				isFavoriteDisabled={ areFavoriteActionsDisabled }
				isHomeUpdating={ isHomeUpdating }
				onToggleFavorite={ ( id ) =>
					toggleFavorite( 'collection', id )
				}
				onSetHome={ setCollectionHome }
				onSelect={ () =>
					navigate( {
						to: '/$',
						params: {
							_splat: computeCollectionUri( collection ),
						},
					} )
				}
				draggedId={ draggedId }
				activeDrop={ activeDrop }
			/>
		),
		[
			selectedCollectionId,
			home,
			isCollectionFavorite,
			areFavoriteActionsDisabled,
			isHomeUpdating,
			toggleFavorite,
			setCollectionHome,
			navigate,
			draggedId,
			activeDrop,
		]
	);

	const autoExpandTimerRef = useRef( null );
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
		let ancestorIds = [];
		if ( selectedId !== null ) {
			ancestorIds = collectAncestorIds( selectedId, pages );
		} else if ( selectedCollectionId !== null ) {
			// Direct links, Home, Favorites, and Recents should reveal nested
			// collections instead of leaving them under a collapsed page.
			const collection = ( collections ?? [] ).find(
				( c ) => c.id === selectedCollectionId
			);
			const parent = Number( collection?.parent ?? 0 );
			if ( parent > 0 ) {
				ancestorIds = [
					parent,
					...collectAncestorIds( parent, pages ),
				];
			}
		}
		if ( ancestorIds.length === 0 ) {
			return;
		}
		setExpandedIds( ( prev ) => {
			let changed = false;
			const next = new Set( prev );
			ancestorIds.forEach( ( id ) => {
				if ( ! next.has( id ) ) {
					next.add( id );
					changed = true;
				}
			} );
			return changed ? next : prev;
		} );
	}, [ selectedId, selectedCollectionId, pages, collections ] );

	useEffect( () => {
		if ( collapsed ) {
			setIsTrashPanelOpen( false );
		}
	}, [ collapsed ] );

	const getEntityRecord = useSelect(
		( select ) => select( 'core' ).getEntityRecord,
		[]
	);

	// Pull the source record straight from core-data for id-based actions like
	// Duplicate and Rename.
	const getRecordById = useCallback(
		( id ) => getEntityRecord( 'postType', POST_TYPE, id ),
		[ getEntityRecord ]
	);

	const toggleExpand = useCallback( ( id ) => {
		setExpandedIds( ( prev ) => {
			const next = new Set( prev );
			if ( next.has( id ) ) {
				next.delete( id );
			} else {
				next.add( id );
			}
			return next;
		} );
	}, [] );

	const expand = useCallback( ( id ) => {
		setExpandedIds( ( prev ) => {
			if ( prev.has( id ) ) {
				return prev;
			}
			const next = new Set( prev );
			next.add( id );
			return next;
		} );
	}, [] );

	// --- Row actions -------------------------------------------------------

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
			path: '/cortext/v1/collections',
			method: 'POST',
			data: {
				title: __( 'Untitled', 'cortext' ),
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

	// First rename promotes draft to private so core regenerates post_name
	// from the new title via wp_unique_post_slug(sanitize_title(...)).
	const renamePage = useCallback(
		async ( id, title ) => {
			const current = getRecordById( id );
			const payload = { id, title };
			if ( current?.status === 'draft' ) {
				payload.status = 'private';
			}
			await saveEntityRecord( 'postType', POST_TYPE, payload );
			await touchRecent( { kind: 'page', id } );
		},
		[ saveEntityRecord, getRecordById, touchRecent ]
	);

	const duplicatePage = useCallback(
		async ( id ) => {
			const source = getRecordById( id );
			if ( ! source ) {
				return;
			}
			const sourceTitle =
				source.title?.raw ?? source.title?.rendered ?? '';
			const created = await saveEntityRecord( 'postType', POST_TYPE, {
				status: 'private',
				title: sourceTitle
					? /* translators: %s: source page title */

					  `${ sourceTitle } ${ __( '(copy)', 'cortext' ) }`
					: __( 'Untitled (copy)', 'cortext' ),
				content: source.content?.raw ?? '',
				parent: source.parent || 0,
				menu_order: ( source.menu_order || 0 ) + 1,
			} );
			if ( created?.id ) {
				if ( source.parent ) {
					expand( source.parent );
				}
				onSelect( created.id, created );
			}
		},
		[ saveEntityRecord, getRecordById, expand, onSelect ]
	);

	// Soft-delete: the server-side cascade trashes descendants. Trash is
	// reversible (the user can restore from the Trash panel), so no
	// confirmation. The editor stays on the trashed page so the user can
	// review what they trashed before deciding whether to restore.
	//
	// Do not use core-data's `deleteEntityRecord` for this soft-delete path:
	// it removes the current post from the raw record store before the canvas
	// has finished its block-editor selection writes, which can crash core-data.
	// Calling REST directly is intentional here, not a generic trash pattern:
	// the REST response is still the source of truth, and we immediately put
	// the returned trashed record back into core-data so the editor can keep
	// rendering the page while the active/trash queries refresh below.
	const trashPage = useCallback(
		async ( id ) => {
			const deleted = await apiFetch( {
				path: `/wp/v2/crtxt_pages/${ id }`,
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
						id,
						pages,
						collections
					)
				);
			} catch ( err ) {
				setFavoritesError(
					err?.message ??
						__(
							'Page moved to Trash, but Favorites could not be updated.',
							'cortext'
						)
				);
			}
			setIsTrashPanelOpen( true );
		},
		[
			invalidateResolution,
			pages,
			collections,
			receiveEntityRecords,
			setFavorites,
		]
	);

	// --- Drag and drop -----------------------------------------------------

	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 5 } } ),
		useSensor( KeyboardSensor )
	);

	const clearAutoExpandTimer = useCallback( () => {
		if ( autoExpandTimerRef.current ) {
			clearTimeout( autoExpandTimerRef.current );
			autoExpandTimerRef.current = null;
		}
	}, [] );

	// Drag/drop spans pages and full-page collections. Use the merged list so
	// `menu_order` is calculated across both types, then save each record
	// through its own REST endpoint.
	const treeRecords = useMemo(
		() => [ ...pages, ...( collections ?? [] ) ],
		[ pages, collections ]
	);

	const handleDragStart = useCallback( ( { active } ) => {
		const id = active?.data?.current?.pageId ?? null;
		setDraggedId( id );
	}, [] );

	const handleDragOver = useCallback(
		( { over } ) => {
			const parsed = over ? parseDropId( over.id ) : null;
			// Collections are leaves; only page moves need cycle checks.
			const draggedIsPage =
				treeRecords.find( ( r ) => r.id === draggedId )?.type ===
				POST_TYPE;
			if (
				parsed &&
				draggedId &&
				( parsed.targetId === draggedId ||
					// `treeRecords` (not `pages`) so the walk follows the
					// `post_parent` chain through nested collections too.
					// Otherwise dropping a page near a collection that
					// hangs from one of its descendants would slip past
					// the guard.
					( draggedIsPage &&
						isDescendantOf(
							parsed.targetId,
							draggedId,
							treeRecords
						) ) )
			) {
				setActiveDrop( null );
				clearAutoExpandTimer();
				return;
			}
			setActiveDrop( parsed );

			// Auto-expand collapsed parent after hovering its "inside" zone.
			clearAutoExpandTimer();
			if ( parsed?.zone === 'inside' ) {
				const target = pages.find( ( p ) => p.id === parsed.targetId );
				const hasKids = treeRecords.some(
					( r ) => ( r.parent || 0 ) === parsed.targetId
				);
				if (
					target &&
					hasKids &&
					! expandedIds.has( parsed.targetId )
				) {
					autoExpandTimerRef.current = setTimeout( () => {
						expand( parsed.targetId );
					}, AUTO_EXPAND_DELAY );
				}
			}
		},
		[
			draggedId,
			pages,
			treeRecords,
			expandedIds,
			expand,
			clearAutoExpandTimer,
		]
	);

	const handleDragEnd = useCallback(
		async ( { over } ) => {
			const parsed = over ? parseDropId( over.id ) : null;
			const activeId = draggedId;
			setDraggedId( null );
			setActiveDrop( null );
			clearAutoExpandTimer();

			if ( ! parsed || ! activeId ) {
				return;
			}

			const updates = computeDropTarget(
				activeId,
				parsed.targetId,
				parsed.zone,
				treeRecords
			);
			if ( ! updates ) {
				return;
			}

			// Updates can touch both post types. Save each record through the
			// endpoint that owns it.
			await Promise.all(
				updates.map( ( u ) => {
					const record = treeRecords.find( ( r ) => r.id === u.id );
					return saveEntityRecord(
						'postType',
						record?.type ?? POST_TYPE,
						u
					);
				} )
			);

			if ( parsed.zone === 'inside' ) {
				expand( parsed.targetId );
			}
		},
		[
			draggedId,
			treeRecords,
			saveEntityRecord,
			expand,
			clearAutoExpandTimer,
		]
	);

	const handleDragCancel = useCallback( () => {
		setDraggedId( null );
		setActiveDrop( null );
		clearAutoExpandTimer();
	}, [ clearAutoExpandTimer ] );

	// --- Render ------------------------------------------------------------

	const draggedPage = draggedId
		? pages.find( ( p ) => p.id === draggedId )
		: null;

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
			</div>
			{ ! collapsed && (
				<div className="cortext-sidebar__content">
					{ favoritesError ? (
						<Notice
							status="error"
							onRemove={ () => setFavoritesError( null ) }
						>
							{ favoritesError }
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
							onRemove={ ( favorite ) =>
								toggleFavorite( favorite.kind, favorite.id )
							}
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
						onDragStart={ handleDragStart }
						onDragOver={ handleDragOver }
						onDragEnd={ handleDragEnd }
						onDragCancel={ handleDragCancel }
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
							{ isResolvingPages && pages.length === 0 && (
								<div className="cortext-sidebar__loading">
									<Spinner />
								</div>
							) }
							{ ! isResolvingPages && pages.length === 0 && (
								<p className="cortext-sidebar__empty">
									{ __( 'No pages yet.', 'cortext' ) }
								</p>
							) }

							<ul className="cortext-sidebar__list">
								{ tree.map( ( node ) => {
									if (
										node.page.type === 'crtxt_collection'
									) {
										return renderCollectionRow(
											node.page,
											0
										);
									}
									return (
										<PageRow
											key={ node.page.id }
											node={ node }
											depth={ 0 }
											selectedId={ selectedId }
											expandedIds={ expandedIds }
											draggedId={ draggedId }
											activeDrop={ activeDrop }
											onSelect={ onSelect }
											onToggleExpand={ toggleExpand }
											onCreateChild={ createChildPage }
											onRename={ renamePage }
											onDuplicate={ duplicatePage }
											onDelete={ trashPage }
											isFavorite={ isPageFavorite }
											isFavoriteDisabled={
												areFavoriteActionsDisabled
											}
											onToggleFavorite={ ( id ) =>
												toggleFavorite( 'page', id )
											}
											onSetHome={ setPageHome }
											home={ home }
											isHomeUpdating={ isHomeUpdating }
											autoRenameId={ autoRenameId }
											onAutoRenameConsumed={ () =>
												setAutoRenameId( null )
											}
											renderCollectionRow={
												renderCollectionRow
											}
										/>
									);
								} ) }
							</ul>
						</SidebarSection>

						<SidebarSection
							id="collections"
							title={ __( 'Collections', 'cortext' ) }
							isCollapsed={ isSectionCollapsed( 'collections' ) }
							onToggle={ () => toggleSection( 'collections' ) }
							actions={
								<Button
									className="cortext-sidebar__section-action"
									icon={ plus }
									size="small"
									label={ __( 'New collection', 'cortext' ) }
									onClick={ createRootCollection }
								/>
							}
						>
							{ isResolvingCollections &&
								topLevelCollections.length === 0 && (
									<div className="cortext-sidebar__loading">
										<Spinner />
									</div>
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
									{ topLevelCollections.map( ( collection ) =>
										renderCollectionRow( collection, 0 )
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
			) }
			{ ! collapsed && isTrashPanelOpen && (
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
