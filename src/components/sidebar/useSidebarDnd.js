import {
	useState,
	useMemo,
	useRef,
	useCallback,
	useEffect,
} from '@wordpress/element';
import {
	PointerSensor,
	KeyboardSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core';

import { computeDropTarget, isDescendantOf } from '../document-tree';
import { POST_TYPE } from '../page-queries';

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

/**
 * Drag-and-drop state for the sidebar tree: sensors, DnD-kit handlers,
 * auto-expand while hovering an `inside` drop zone, and the drag state the
 * component renders.
 *
 * Dragging works on any node in the tree, pages and nested collections
 * alike. They share one ordered list here; each move hits the same
 * `crtxt_document` REST endpoint.
 *
 * @param {Object}   args
 * @param {Array}    args.pages            Loaded `crtxt_document` records (every non-row document: pages and collections).
 * @param {Set}      args.expandedIds      Currently expanded node ids (from `useSidebarTree`).
 * @param {Function} args.expand           Expand callback from `useSidebarTree`.
 * @param {Function} args.loadBranch       Loads a lazy tree branch.
 * @param {Function} args.refreshBranch    Refreshes a loaded lazy tree branch.
 * @param {Function} args.getBranch        Reads a lazy tree branch state.
 * @param {Function} args.saveEntityRecord core-data dispatcher used to persist moves.
 */
export default function useSidebarDnd( {
	pages,
	expandedIds,
	expand,
	loadBranch,
	refreshBranch,
	getBranch,
	saveEntityRecord,
} ) {
	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 5 } } ),
		useSensor( KeyboardSensor )
	);

	const [ draggedId, setDraggedId ] = useState( null );
	const [ activeDrop, setActiveDrop ] = useState( null );
	const autoExpandTimerRef = useRef( null );
	const recordsRef = useRef( [] );

	const clearAutoExpandTimer = useCallback( () => {
		if ( autoExpandTimerRef.current ) {
			clearTimeout( autoExpandTimerRef.current );
			autoExpandTimerRef.current = null;
		}
	}, [] );

	// `pages` already lists every non-row document: in the unified model pages
	// and collections share one post type and one query (`cortext_no_trait`).
	// The separate collections list is a subset of it, so merging the two would
	// list every collection twice and corrupt the sibling order math in
	// `computeDropTarget`.
	const treeRecords = useMemo( () => pages, [ pages ] );

	useEffect( () => {
		recordsRef.current = treeRecords;
	}, [ treeRecords ] );

	const handleDragStart = useCallback( ( { active } ) => {
		const id = active?.data?.current?.pageId ?? null;
		setDraggedId( id );
	}, [] );

	const handleDragOver = useCallback(
		( { over } ) => {
			const parsed = over ? parseDropId( over.id ) : null;
			// Collections are leaves, so only page moves can create cycles.
			const draggedIsPage =
				treeRecords.find( ( r ) => r.id === draggedId )?.type ===
				POST_TYPE;
			if (
				parsed &&
				draggedId &&
				( parsed.targetId === draggedId ||
					// Use `treeRecords`, not `pages`, so the walk follows
					// `post_parent` through nested collections too. Otherwise
					// dropping a page near one of its descendant collections
					// could pass the guard.
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

			// Expand a collapsed parent after the pointer rests inside it.
			clearAutoExpandTimer();
			if ( parsed?.zone === 'inside' ) {
				const target = pages.find( ( p ) => p.id === parsed.targetId );
				if ( target && ! expandedIds.has( parsed.targetId ) ) {
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

			let records = recordsRef.current;
			const target = records.find( ( r ) => r.id === parsed.targetId );
			const active = records.find( ( r ) => r.id === activeId );
			if ( ! target || ! active ) {
				return;
			}
			const destinationParent =
				parsed.zone === 'inside'
					? parsed.targetId
					: Number( target.parent || 0 );
			let destinationBranch = getBranch?.( destinationParent );
			if (
				parsed.zone === 'inside' &&
				! destinationBranch?.hasResolved
			) {
				destinationBranch = await loadBranch?.( destinationParent );
				// `recordsRef` only catches up to the loaded children on the
				// next render, so merge them in from the returned branch.
				// Without them `computeDropTarget` treats the parent as empty
				// and drops the row at `menu_order` 0 instead of appending it.
				const byId = new Map();
				[
					...recordsRef.current,
					...( destinationBranch?.records ?? [] ),
				].forEach( ( record ) => byId.set( record.id, record ) );
				records = [ ...byId.values() ];
			}
			if (
				! destinationBranch?.hasResolved ||
				destinationBranch.page < destinationBranch.totalPages
			) {
				return;
			}

			const updates = computeDropTarget(
				activeId,
				parsed.targetId,
				parsed.zone,
				records
			);
			if ( ! updates ) {
				return;
			}

			// A move can touch both post types, so save each record through
			// the endpoint that owns it.
			await Promise.all(
				updates.map( ( u ) => {
					const record = records.find( ( r ) => r.id === u.id );
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
			refreshBranch?.( Number( active.parent || 0 ) );
			refreshBranch?.( destinationParent );
		},
		[
			draggedId,
			saveEntityRecord,
			expand,
			loadBranch,
			refreshBranch,
			getBranch,
			clearAutoExpandTimer,
		]
	);

	const handleDragCancel = useCallback( () => {
		setDraggedId( null );
		setActiveDrop( null );
		clearAutoExpandTimer();
	}, [ clearAutoExpandTimer ] );

	const draggedPage = draggedId
		? pages.find( ( p ) => p.id === draggedId )
		: null;

	return {
		sensors,
		draggedId,
		draggedPage,
		activeDrop,
		handlers: {
			handleDragStart,
			handleDragOver,
			handleDragEnd,
			handleDragCancel,
		},
	};
}
