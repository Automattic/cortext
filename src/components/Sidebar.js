import { __ } from '@wordpress/i18n';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import {
	useState,
	useMemo,
	useRef,
	useCallback,
	useEffect,
} from '@wordpress/element';
import {
	Button,
	Spinner,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
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

import PageRow from './PageRow';
import {
	buildTree,
	collectDescendants,
	computeDropTarget,
	isDescendantOf,
	nextChildOrder,
} from './pages-tree';
import { computeUri, parseIdFromUri } from '../router/useResolveEntity';

const POST_TYPE = 'cortext_page';

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

export default function Sidebar() {
	// TODO(scale): per_page: 100 is the REST collection endpoint's hard ceiling.
	// Workspaces are expected to exceed 100 pages — pages past the cap won't
	// appear in the tree. Followup needs a lazy-loaded tree (load children on
	// expand) or a paginated fetch of the full page set.
	const { records, isResolving } = useEntityRecords( 'postType', POST_TYPE, {
		per_page: 100,
		status: [ 'draft', 'private', 'publish' ],
		context: 'edit',
	} );

	const { records: collections, isResolving: isResolvingCollections } =
		useEntityRecords( 'postType', 'cortext_collection', {
			per_page: 100,
			status: 'publish',
			context: 'edit',
		} );
	const { saveEntityRecord, deleteEntityRecord } = useDispatch( 'core' );
	const pages = useMemo( () => records ?? [], [ records ] );
	const navigate = useNavigate();
	const params = useParams( { strict: false } );
	const activeUri = params._splat ?? '';
	const adminUrl = window.cortextSettings?.adminUrl ?? '/wp-admin/';

	const selectedId = useMemo(
		() => parseIdFromUri( activeUri ),
		[ activeUri ]
	);

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
		const canonical = computeUri( current );
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
				params: { _splat: computeUri( page ) },
			} );
		},
		[ navigate, pages ]
	);

	const tree = useMemo( () => buildTree( pages ), [ pages ] );

	const [ expandedIds, setExpandedIds ] = useState( () => new Set() );
	const [ draggedId, setDraggedId ] = useState( null );
	const [ activeDrop, setActiveDrop ] = useState( null );
	const [ autoRenameId, setAutoRenameId ] = useState( null );
	const [ pendingDeleteId, setPendingDeleteId ] = useState( null );

	const autoExpandTimerRef = useRef( null );

	// Pull the source record straight from core-data for Duplicate (needs
	// content.raw, which useEntityRecords above already fetches via
	// context=edit).
	const getRecordById = useSelect(
		( select ) => ( id ) =>
			select( 'core' ).getEntityRecord( 'postType', POST_TYPE, id ),
		[]
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
		},
		[ saveEntityRecord, getRecordById ]
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

	const confirmDelete = useCallback( async () => {
		const id = pendingDeleteId;
		setPendingDeleteId( null );
		if ( ! id ) {
			return;
		}
		const descendants = collectDescendants( id, pages );
		// Delete children first, then the root.
		for ( const childId of descendants ) {
			await deleteEntityRecord( 'postType', POST_TYPE, childId, {
				force: true,
			} );
		}
		await deleteEntityRecord( 'postType', POST_TYPE, id, { force: true } );
		if ( selectedId === id || descendants.includes( selectedId ) ) {
			onSelect( null );
		}
	}, [ pendingDeleteId, pages, deleteEntityRecord, selectedId, onSelect ] );

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

	const handleDragStart = useCallback( ( { active } ) => {
		const id = active?.data?.current?.pageId ?? null;
		setDraggedId( id );
	}, [] );

	const handleDragOver = useCallback(
		( { over } ) => {
			const parsed = over ? parseDropId( over.id ) : null;
			if (
				parsed &&
				draggedId &&
				( parsed.targetId === draggedId ||
					// Reject cycles cheaply here too — computeDropTarget is
					// the source of truth, but hiding the indicator feels
					// better than flashing one.
					isDescendantOf( parsed.targetId, draggedId, pages ) )
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
				const hasKids = pages.some(
					( p ) => ( p.parent || 0 ) === parsed.targetId
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
		[ draggedId, pages, expandedIds, expand, clearAutoExpandTimer ]
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
				pages
			);
			if ( ! updates ) {
				return;
			}

			// The dragged record's update first, then siblings. Fire them in
			// parallel — they touch different records.
			await Promise.all(
				updates.map( ( u ) =>
					saveEntityRecord( 'postType', POST_TYPE, u )
				)
			);

			if ( parsed.zone === 'inside' ) {
				expand( parsed.targetId );
			}
		},
		[ draggedId, pages, saveEntityRecord, expand, clearAutoExpandTimer ]
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
		<aside className="cortext-sidebar">
			<div className="cortext-sidebar__header">
				<Button
					icon="arrow-left-alt2"
					label={ __( 'Back to WordPress', 'cortext' ) }
					href={ adminUrl }
				/>
				<Button variant="primary" onClick={ createRootPage }>
					{ __( 'New page', 'cortext' ) }
				</Button>
			</div>
			<h2 className="cortext-sidebar__section-title">
				{ __( 'Pages', 'cortext' ) }
			</h2>
			{ isResolving && pages.length === 0 && (
				<div className="cortext-sidebar__loading">
					<Spinner />
				</div>
			) }
			{ ! isResolving && pages.length === 0 && (
				<p className="cortext-sidebar__empty">
					{ __( 'No pages yet.', 'cortext' ) }
				</p>
			) }

			<DndContext
				sensors={ sensors }
				collisionDetection={ pointerWithin }
				onDragStart={ handleDragStart }
				onDragOver={ handleDragOver }
				onDragEnd={ handleDragEnd }
				onDragCancel={ handleDragCancel }
			>
				<ul className="cortext-sidebar__list">
					{ tree.map( ( node ) => (
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
							onDelete={ ( id ) => setPendingDeleteId( id ) }
							autoRenameId={ autoRenameId }
							onAutoRenameConsumed={ () =>
								setAutoRenameId( null )
							}
						/>
					) ) }
				</ul>

				<DragOverlay>
					{ draggedPage ? (
						<div className="cortext-sidebar__drag-preview">
							{ draggedPage.title?.rendered?.trim() ||
								__( '(untitled)', 'cortext' ) }
						</div>
					) : null }
				</DragOverlay>
			</DndContext>

			<h2 className="cortext-sidebar__section-title">
				{ __( 'Collections', 'cortext' ) }
			</h2>
			{ isResolvingCollections && ! collections?.length && (
				<div className="cortext-sidebar__loading">
					<Spinner />
				</div>
			) }
			{ ! isResolvingCollections && ! collections?.length && (
				<p className="cortext-sidebar__empty">
					{ __( 'No collections yet.', 'cortext' ) }
				</p>
			) }
			{ collections?.length > 0 && (
				<ul className="cortext-sidebar__list">
					{ collections.map( ( collection ) => (
						<li
							key={ collection.id }
							className="cortext-sidebar__node"
						>
							<div className="cortext-sidebar__row">
								<Button
									className="cortext-sidebar__title"
									variant="tertiary"
								>
									{ collection.title.rendered }
								</Button>
							</div>
						</li>
					) ) }
				</ul>
			) }

			{ pendingDeleteId !== null && (
				<ConfirmDialog
					onConfirm={ confirmDelete }
					onCancel={ () => setPendingDeleteId( null ) }
					confirmButtonText={ __( 'Delete', 'cortext' ) }
				>
					{ renderDeleteMessage( pendingDeleteId, pages ) }
				</ConfirmDialog>
			) }
		</aside>
	);
}

function renderDeleteMessage( id, pages ) {
	const descendants = collectDescendants( id, pages );
	if ( descendants.length === 0 ) {
		return __( 'Delete this page? This cannot be undone.', 'cortext' );
	}
	return __(
		'Delete this page and all its child pages? This cannot be undone.',
		'cortext'
	);
}
