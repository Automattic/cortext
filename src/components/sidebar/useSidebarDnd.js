import { useState, useMemo, useRef, useCallback } from '@wordpress/element';
import {
	PointerSensor,
	KeyboardSensor,
	useSensor,
	useSensors,
} from '@dnd-kit/core';

import { computeDropTarget, isDescendantOf } from '../pages-tree';
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
 * @param {Array}    args.pages            Loaded `crtxt_document` records.
 * @param {Array}    args.collections      Loaded `crtxt_document` collection records (may be undefined while resolving).
 * @param {Set}      args.expandedIds      Currently expanded node ids (from `useSidebarTree`).
 * @param {Function} args.expand           Expand callback from `useSidebarTree`.
 * @param {Function} args.saveEntityRecord core-data dispatcher used to persist moves.
 */
export default function useSidebarDnd( {
	pages,
	collections,
	expandedIds,
	expand,
	saveEntityRecord,
} ) {
	const sensors = useSensors(
		useSensor( PointerSensor, { activationConstraint: { distance: 5 } } ),
		useSensor( KeyboardSensor )
	);

	const [ draggedId, setDraggedId ] = useState( null );
	const [ activeDrop, setActiveDrop ] = useState( null );
	const autoExpandTimerRef = useRef( null );

	const clearAutoExpandTimer = useCallback( () => {
		if ( autoExpandTimerRef.current ) {
			clearTimeout( autoExpandTimerRef.current );
			autoExpandTimerRef.current = null;
		}
	}, [] );

	// Pages and full-page collections share the same drag order, but each
	// record is still saved through its own REST endpoint.
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

			// A move can touch both post types, so save each record through
			// the endpoint that owns it.
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
