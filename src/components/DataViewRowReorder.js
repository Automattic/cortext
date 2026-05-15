import apiFetch from '@wordpress/api-fetch';
import {
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { useDispatch } from '@wordpress/data';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import { store as noticesStore } from '@wordpress/notices';
import {
	DndContext,
	DragOverlay,
	KeyboardSensor,
	PointerSensor,
	closestCenter,
	pointerWithin,
	useDroppable,
	useSensor,
	useSensors,
} from '@dnd-kit/core';

import RowDragHandle from './RowDragHandle';
import { ROW_DROP_AFTER, ROW_DROP_BEFORE } from './row-reorder';

const DRAG_ACTIVATION_DISTANCE = 5;
const ROW_REORDER_NOTICE_ID = 'cortext-row-reorder-failed';
const MANUAL_SORT_ID = 'manual';
const ROW_DRAG_OVERLAY_Z_INDEX = 100002;
const ROW_DISPLACED_CLASS = 'cortext-row-reorder-target--displaced';
const ROW_ACTIVE_CLASS = 'cortext-row-reorder-target--active';
const ROW_DROP_GAP = 'gap';
const ROW_DRAGGING_CLASS = 'cortext-row-dragging';
const ROW_SUPPRESS_HOVER_CLASS = 'cortext-row-reorder-suppress-hover';
const ROW_NO_TRANSITION_CLASS = 'cortext-row-reorder-no-transition';
const HOVER_SUPPRESSION_RELEASE_DELAY = 120;
const FREEZE_SAFETY_TIMEOUT = 3000;

// tech-debt.md#49: DataViews doesn't expose row refs or reorder hooks.
// Keep the DOM selectors for this adapter in one place.
const ROW_SELECTORS = {
	table: '.dataviews-view-table tbody > tr',
	list: [
		'.dataviews-view-list__item',
		'.dataviews-view-list li',
		'.dataviews-view-list [role="row"]',
	].join( ',' ),
	grid: [
		'.dataviews-view-grid__card',
		'.dataviews-view-grid li',
		'.dataviews-view-grid [role="gridcell"]',
	].join( ',' ),
};

function rowLabel( row ) {
	const title = row?.title;
	if ( typeof title === 'string' ) {
		return title;
	}
	return title?.raw || title?.rendered || __( '(untitled)', 'cortext' );
}

function sameRowItems( a, b ) {
	return (
		a.length === b.length &&
		a.every(
			( item, index ) =>
				item.el === b[ index ]?.el &&
				item.handleEl === b[ index ]?.handleEl &&
				item.rowId === b[ index ]?.rowId &&
				item.rect.top === b[ index ]?.rect.top &&
				item.rect.left === b[ index ]?.rect.left &&
				item.rect.width === b[ index ]?.rect.width &&
				item.rect.height === b[ index ]?.rect.height &&
				item.previewSignature === b[ index ]?.previewSignature &&
				item.previewDensity === b[ index ]?.previewDensity
		)
	);
}

// Remove our translate3d() from getBoundingClientRect() so top/left stay tied
// to layout, not the frozen visual position. Otherwise a view change during
// freeze can feed transformed values back into displacementForDrop and make
// the row jump.
function parseTranslate( transform ) {
	if ( ! transform ) {
		return { x: 0, y: 0 };
	}
	const match = transform.match(
		/translate3d\(\s*(-?\d+(?:\.\d+)?)px\s*,\s*(-?\d+(?:\.\d+)?)px/
	);
	if ( ! match ) {
		return { x: 0, y: 0 };
	}
	return { x: parseFloat( match[ 1 ] ), y: parseFloat( match[ 2 ] ) };
}

function rowRect( el ) {
	const rect = el.getBoundingClientRect();
	const { x, y } = parseTranslate( el.style.transform );
	return {
		top: Math.round( rect.top - y ),
		left: Math.round( rect.left - x ),
		width: Math.round( rect.width ),
		height: Math.round( rect.height ),
	};
}

function normalizePreviewText( text ) {
	return text.replace( /\s+/g, ' ' ).trim();
}

function tableDataCells( rowElement ) {
	const cells = Array.from( rowElement.children ).filter( ( child ) =>
		child.matches( 'td, th' )
	);

	return cells.filter(
		( cell ) =>
			! cell.classList.contains( 'dataviews-view-table__checkbox-column' )
	);
}

function tableHandleTarget( rowElement ) {
	const cells = tableDataCells( rowElement );

	return cells[ 0 ] ?? rowElement.querySelector( 'td, th' ) ?? rowElement;
}

function previewDensity( rowElement, view ) {
	const table = rowElement.closest( '.dataviews-view-table' );
	if ( table?.classList.contains( 'has-compact-density' ) ) {
		return 'compact';
	}
	if ( table?.classList.contains( 'has-comfortable-density' ) ) {
		return 'comfortable';
	}

	const density = view?.layout?.density;
	return [ 'compact', 'comfortable', 'balanced' ].includes( density )
		? density
		: 'balanced';
}

function rowPreviewCells( rowElement, layout, row ) {
	const label = rowLabel( row );
	if ( layout === 'table' ) {
		const cells = tableDataCells( rowElement ).slice( 0, 4 );

		return cells.length
			? cells.map( ( cell ) => ( {
					source: cell,
					text: normalizePreviewText( cell.textContent ?? '' ),
					width: Math.round( cell.getBoundingClientRect().width ),
			  } ) )
			: [ { text: label } ];
	}

	return [ { text: label } ];
}

function rowPreviewSignature( cells ) {
	return cells.map( ( cell ) => cell.text ).join( '\u0000' );
}

function removePreviewInteractivity( node ) {
	node.querySelectorAll(
		'a, button, input, select, textarea, [tabindex]'
	).forEach( ( child ) => {
		child.setAttribute( 'tabindex', '-1' );
		child.setAttribute( 'aria-hidden', 'true' );
	} );
}

function removeClonedIds( node ) {
	node.querySelectorAll( '[id]' ).forEach( ( child ) => {
		child.removeAttribute( 'id' );
	} );
}

function removePreviewChrome( node ) {
	node.querySelectorAll( '.cortext-row-drag-handle' ).forEach( ( child ) => {
		child.remove();
	} );
}

function normalizeClonedCellContent( node ) {
	node.querySelectorAll(
		'.dataviews-view-table__cell-content-wrapper'
	).forEach( ( child ) => {
		child.classList.add( 'cortext-row-drag-preview__cell-content-wrapper' );
	} );
}

function appendPlainPreviewContent( node, cells ) {
	for ( const [ index, cell ] of cells.entries() ) {
		const cellElement = node.ownerDocument.createElement( 'div' );
		cellElement.className =
			'cortext-row-drag-preview__cell' +
			( index === 0 ? ' cortext-row-drag-preview__cell--primary' : '' );
		if ( cell.width ) {
			cellElement.style.flexBasis = `${ cell.width }px`;
		}
		if ( cell.source ) {
			for ( const child of Array.from( cell.source.childNodes ) ) {
				cellElement.appendChild( child.cloneNode( true ) );
			}
			removePreviewChrome( cellElement );
			removePreviewInteractivity( cellElement );
			removeClonedIds( cellElement );
			normalizeClonedCellContent( cellElement );
		}
		if ( ! normalizePreviewText( cellElement.textContent ?? '' ) ) {
			cellElement.textContent = cell.text;
		}
		node.appendChild( cellElement );
	}
}

function RowDragPreview( { row } ) {
	const previewRef = useRef( null );
	const width = Math.min( Math.max( row.rect?.width ?? 320, 240 ), 720 );
	const density = row.previewDensity ?? 'balanced';

	useLayoutEffect( () => {
		const node = previewRef.current;
		if ( ! node ) {
			return;
		}

		const cells = row.previewCells?.length
			? row.previewCells
			: [ { text: row.label } ];
		node.replaceChildren();
		appendPlainPreviewContent( node, cells );
	}, [ row ] );

	return (
		<div
			ref={ previewRef }
			className={ `cortext-row-drag-preview cortext-row-drag-preview--${ density }` }
			style={ { width: `${ width }px` } }
			aria-label={ row.label }
		/>
	);
}

function renderedRowFor( renderedRows, row ) {
	const rowId = Number( row?.rowId );
	return (
		renderedRows.find( ( renderedRow ) => renderedRow.rowId === rowId ) ??
		row
	);
}

function handleTargetFor( rowElement, layout ) {
	return layout === 'table' ? tableHandleTarget( rowElement ) : rowElement;
}

function visibleElements( wrapper, selector ) {
	if ( ! selector ) {
		return [];
	}
	return Array.from( wrapper.querySelectorAll( selector ) ).filter(
		( el ) => el.offsetParent !== null || el.getClientRects().length > 0
	);
}

function findRenderedRows( wrapper, view, rows ) {
	const layout = view?.type ?? 'table';
	const elements = visibleElements( wrapper, ROW_SELECTORS[ layout ] );
	return ( rows ?? [] )
		.map( ( row, index ) => {
			const el = elements[ index ];
			if ( ! el || ! row?.id ) {
				return null;
			}
			const rect = rowRect( el );
			const handleEl = handleTargetFor( el, layout );
			const previewCells = rowPreviewCells( el, layout, row );
			return {
				rowId: Number( row.id ),
				index,
				label: rowLabel( row ),
				previewCells,
				previewSignature: rowPreviewSignature( previewCells ),
				previewDensity: previewDensity( el, view ),
				el,
				handleEl,
				rect,
			};
		} )
		.filter( Boolean );
}

function useRenderedRows( wrapperRef, view, rows ) {
	const [ renderedRows, setRenderedRows ] = useState( [] );
	const renderedRowsRef = useRef( renderedRows );
	renderedRowsRef.current = renderedRows;
	const decoratedRowsRef = useRef( [] );
	const decoratedCellsRef = useRef( [] );

	useEffect( () => {
		const wrapper = wrapperRef.current;
		if ( ! wrapper ) {
			return undefined;
		}

		let frame = null;
		const sync = () => {
			if ( frame ) {
				return;
			}
			frame = window.requestAnimationFrame( () => {
				frame = null;
				const next = findRenderedRows( wrapper, view, rows );
				const nextRows = next.map( ( item ) => item.el );
				const nextCells = next.map( ( item ) => item.handleEl );
				for ( const el of decoratedRowsRef.current ) {
					if ( ! nextRows.includes( el ) ) {
						el.classList.remove( 'cortext-row-reorder-target' );
					}
				}
				for ( const el of decoratedCellsRef.current ) {
					if ( ! nextCells.includes( el ) ) {
						el.classList.remove( 'cortext-row-reorder-cell' );
					}
				}
				for ( const el of nextRows ) {
					el.classList.add( 'cortext-row-reorder-target' );
				}
				for ( const el of nextCells ) {
					el.classList.add( 'cortext-row-reorder-cell' );
				}
				decoratedRowsRef.current = nextRows;
				decoratedCellsRef.current = nextCells;
				if ( ! sameRowItems( next, renderedRowsRef.current ) ) {
					setRenderedRows( next );
				}
			} );
		};

		sync();
		const observer = new window.MutationObserver( sync );
		observer.observe( wrapper, { childList: true, subtree: true } );
		wrapper.addEventListener( 'scroll', sync, true );
		window.addEventListener( 'resize', sync );
		window.addEventListener( 'scroll', sync, true );

		return () => {
			if ( frame ) {
				window.cancelAnimationFrame( frame );
			}
			observer.disconnect();
			wrapper.removeEventListener( 'scroll', sync, true );
			window.removeEventListener( 'resize', sync );
			window.removeEventListener( 'scroll', sync, true );
			for ( const el of decoratedRowsRef.current ) {
				el.classList.remove( 'cortext-row-reorder-target' );
			}
			for ( const el of decoratedCellsRef.current ) {
				el.classList.remove( 'cortext-row-reorder-cell' );
			}
			decoratedRowsRef.current = [];
			decoratedCellsRef.current = [];
		};
	}, [ wrapperRef, view, rows ] );

	return renderedRows;
}

function parseDropData( over ) {
	const data = over?.data?.current;
	if (
		data?.type === ROW_DROP_GAP &&
		Number.isInteger( data.insertionIndex ) &&
		( data.beforeId || data.afterId )
	) {
		return {
			type: ROW_DROP_GAP,
			insertionIndex: data.insertionIndex,
			beforeId: data.beforeId ?? null,
			afterId: data.afterId ?? null,
		};
	}

	if (
		! data ||
		! data.rowId ||
		( data.zone !== ROW_DROP_BEFORE && data.zone !== ROW_DROP_AFTER )
	) {
		return null;
	}
	return {
		rowId: data.rowId,
		zone: data.zone,
	};
}

function rowCollisionDetection( args ) {
	if ( args.pointerCoordinates ) {
		return pointerWithin( args );
	}

	return closestCenter( args );
}

function insertionIndexForDrop( ids, activeDrop ) {
	if ( activeDrop?.type === ROW_DROP_GAP ) {
		return activeDrop.insertionIndex >= 0 &&
			activeDrop.insertionIndex <= ids.length
			? activeDrop.insertionIndex
			: null;
	}

	const targetId = Number( activeDrop?.rowId );
	const targetIndex = ids.indexOf( targetId );
	if (
		! targetId ||
		targetIndex === -1 ||
		( activeDrop?.zone !== ROW_DROP_BEFORE &&
			activeDrop?.zone !== ROW_DROP_AFTER )
	) {
		return null;
	}

	return activeDrop.zone === ROW_DROP_AFTER ? targetIndex + 1 : targetIndex;
}

function finalIndexForInsertion( insertionIndex, activeIndex, length ) {
	return Math.min(
		length - 1,
		Math.max(
			0,
			insertionIndex > activeIndex ? insertionIndex - 1 : insertionIndex
		)
	);
}

function displacementForDrop( renderedRows, activeRow, activeDrop ) {
	const activeId = Number( activeRow?.rowId );
	const ids = renderedRows.map( ( row ) => row.rowId );
	const activeIndex = ids.indexOf( activeId );
	const insertionIndex = insertionIndexForDrop( ids, activeDrop );

	if ( ! activeId || activeIndex === -1 || insertionIndex === null ) {
		return { activeId, activeOffset: null, offsets: new Map() };
	}

	if (
		insertionIndex === activeIndex ||
		insertionIndex === activeIndex + 1
	) {
		return { activeId, activeOffset: null, offsets: new Map() };
	}

	const offsets = new Map();
	let activeOffset = null;
	const finalIndex = finalIndexForInsertion(
		insertionIndex,
		activeIndex,
		renderedRows.length
	);
	const nextRows = renderedRows.filter( ( row ) => row.rowId !== activeId );
	nextRows.splice( finalIndex, 0, renderedRows[ activeIndex ] );

	for ( const [ index, row ] of nextRows.entries() ) {
		const finalRect = renderedRows[ index ]?.rect;
		if ( ! finalRect ) {
			continue;
		}

		const offset = {
			x: Math.round( finalRect.left - row.rect.left ),
			y: Math.round( finalRect.top - row.rect.top ),
		};

		if ( row.rowId === activeId ) {
			activeOffset = offset.x || offset.y ? offset : null;
		} else if ( offset.x || offset.y ) {
			offsets.set( row.rowId, offset );
		}
	}
	return { activeId, activeOffset, offsets };
}

function rowIds( rows ) {
	return ( rows ?? [] )
		.map( ( row ) => Number( row?.id ) )
		.filter( ( rowId ) => rowId > 0 );
}

function reorderRequestForDrop( rows, rowId, activeDrop ) {
	const ids = rowIds( rows );
	const activeId = Number( rowId );
	const activeIndex = ids.indexOf( activeId );
	const insertionIndex = insertionIndexForDrop( ids, activeDrop );

	if ( ! activeId || activeIndex === -1 || insertionIndex === null ) {
		return null;
	}

	if (
		insertionIndex === activeIndex ||
		insertionIndex === activeIndex + 1
	) {
		return null;
	}

	const withoutActive = ( rows ?? [] ).filter(
		( row ) => Number( row?.id ) !== activeId
	);
	const finalIndex = Math.min(
		withoutActive.length,
		Math.max(
			0,
			insertionIndex > activeIndex ? insertionIndex - 1 : insertionIndex
		)
	);
	const after = withoutActive[ finalIndex - 1 ];
	const before = withoutActive[ finalIndex ];
	if ( ! after && ! before ) {
		return null;
	}

	return {
		before_id: before ? Number( before.id ) : null,
		after_id: after ? Number( after.id ) : null,
	};
}

function expectedOrderAfterDrop( rows, rowId, activeDrop ) {
	const ids = rowIds( rows );
	const activeId = Number( rowId );
	const activeIndex = ids.indexOf( activeId );
	const insertionIndex = insertionIndexForDrop( ids, activeDrop );

	if ( ! activeId || activeIndex === -1 || insertionIndex === null ) {
		return null;
	}

	if (
		insertionIndex === activeIndex ||
		insertionIndex === activeIndex + 1
	) {
		return null;
	}

	const nextIds = ids.filter( ( id ) => id !== activeId );
	const finalIndex = Math.min(
		nextIds.length,
		Math.max(
			0,
			insertionIndex > activeIndex ? insertionIndex - 1 : insertionIndex
		)
	);
	nextIds.splice( finalIndex, 0, activeId );
	return nextIds;
}

function sameRowOrder( a, b ) {
	return (
		Array.isArray( a ) &&
		Array.isArray( b ) &&
		a.length === b.length &&
		a.every( ( value, index ) => value === b[ index ] )
	);
}

function clearRowDisplacements( elements ) {
	for ( const el of elements ) {
		el.classList.remove( ROW_ACTIVE_CLASS, ROW_DISPLACED_CLASS );
		el.style.removeProperty( 'transform' );
	}
}

function rowTransform( offset ) {
	return `translate3d(${ offset.x ? `${ offset.x }px` : '0' }, ${
		offset.y ? `${ offset.y }px` : '0'
	}, 0)`;
}

function useRowDisplacement(
	renderedRows,
	activeRow,
	activeDrop,
	{ showActiveRow = false } = {}
) {
	const changedRowsRef = useRef( [] );
	const frameRef = useRef( null );

	useLayoutEffect( () => {
		if ( frameRef.current ) {
			window.cancelAnimationFrame( frameRef.current );
			frameRef.current = null;
		}

		if ( ! activeRow ) {
			clearRowDisplacements( changedRowsRef.current );
			changedRowsRef.current = [];
			return;
		}

		const { activeId, activeOffset, offsets } = displacementForDrop(
			renderedRows,
			activeRow,
			activeDrop
		);
		const changedRows = [];
		const changedElements = new Set();
		const pendingTransforms = [];
		const rowsNeedingFlush = [];

		for ( const row of renderedRows ) {
			if ( row.rowId === activeId ) {
				if ( showActiveRow ) {
					row.el.classList.remove( ROW_ACTIVE_CLASS );
					if ( activeOffset ) {
						row.el.style.transform = rowTransform( activeOffset );
						row.el.classList.add( ROW_DISPLACED_CLASS );
					} else {
						row.el.classList.remove( ROW_DISPLACED_CLASS );
						row.el.style.removeProperty( 'transform' );
					}
				} else {
					row.el.classList.add( ROW_ACTIVE_CLASS );
					row.el.classList.remove( ROW_DISPLACED_CLASS );
					row.el.style.removeProperty( 'transform' );
				}
				changedRows.push( row.el );
				changedElements.add( row.el );
			} else {
				row.el.classList.remove( ROW_ACTIVE_CLASS );
			}

			const offset = offsets.get( row.rowId );
			if ( offset ) {
				if ( showActiveRow ) {
					row.el.style.transform = rowTransform( offset );
				} else {
					if ( ! row.el.style.transform ) {
						row.el.style.transform = 'translate3d(0, 0, 0)';
						rowsNeedingFlush.push( row.el );
					}
					pendingTransforms.push( [
						row.el,
						rowTransform( offset ),
					] );
				}
				row.el.classList.add( ROW_DISPLACED_CLASS );
				changedRows.push( row.el );
				changedElements.add( row.el );
			}
		}

		for ( const el of changedRowsRef.current ) {
			if ( ! changedElements.has( el ) ) {
				clearRowDisplacements( [ el ] );
			}
		}

		for ( const el of rowsNeedingFlush ) {
			el.getBoundingClientRect();
		}

		if ( pendingTransforms.length ) {
			frameRef.current = window.requestAnimationFrame( () => {
				frameRef.current = null;
				for ( const [ el, transform ] of pendingTransforms ) {
					el.style.transform = transform;
				}
			} );
		}

		changedRowsRef.current = changedRows;
	}, [ activeDrop, activeRow, renderedRows, showActiveRow ] );

	useEffect( () => {
		return () => {
			if ( frameRef.current ) {
				window.cancelAnimationFrame( frameRef.current );
				frameRef.current = null;
			}
			clearRowDisplacements( changedRowsRef.current );
			changedRowsRef.current = [];
		};
	}, [] );
}

function usesLinearGaps( view ) {
	return ( view?.type ?? 'table' ) === 'table' || view?.type === 'list';
}

function linearRowGaps( renderedRows, activeRow ) {
	const activeId = Number( activeRow?.rowId );
	const activeIndex = renderedRows.findIndex(
		( row ) => row.rowId === activeId
	);
	const gaps = [];

	for ( let index = 0; index <= renderedRows.length; index++ ) {
		if (
			activeIndex !== -1 &&
			( index === activeIndex || index === activeIndex + 1 )
		) {
			continue;
		}

		const after = renderedRows[ index - 1 ] ?? null;
		const before = renderedRows[ index ] ?? null;
		if ( ! after && ! before ) {
			continue;
		}

		const anchor = before ?? after;
		const top = after
			? after.rect.top + after.rect.height / 2
			: before.rect.top;
		const bottom = before
			? before.rect.top + before.rect.height / 2
			: after.rect.top + after.rect.height;
		const lineTop = before
			? before.rect.top
			: after.rect.top + after.rect.height;
		const left = Math.min(
			after?.rect.left ?? anchor.rect.left,
			before?.rect.left ?? anchor.rect.left
		);
		const right = Math.max(
			after
				? after.rect.left + after.rect.width
				: anchor.rect.left + anchor.rect.width,
			before
				? before.rect.left + before.rect.width
				: anchor.rect.left + anchor.rect.width
		);

		gaps.push( {
			index,
			beforeId: before?.rowId ?? null,
			afterId: after?.rowId ?? null,
			rect: {
				top: Math.round( top ),
				left: Math.round( left ),
				width: Math.round( right - left ),
				height: Math.max( 8, Math.round( bottom - top ) ),
			},
			lineOffset: Math.round( lineTop - top ),
		} );
	}

	return gaps;
}

function RowGapDropZone( { gap, activeDrop } ) {
	const data = {
		type: ROW_DROP_GAP,
		insertionIndex: gap.index,
		beforeId: gap.beforeId,
		afterId: gap.afterId,
	};
	const { setNodeRef, isOver } = useDroppable( {
		id: `row-gap:${ gap.index }:${ gap.afterId ?? 'start' }:${
			gap.beforeId ?? 'end'
		}`,
		data,
	} );
	const isActive =
		isOver ||
		( activeDrop?.type === ROW_DROP_GAP &&
			activeDrop.insertionIndex === gap.index );

	return (
		<div
			ref={ setNodeRef }
			className={
				'cortext-row-drop-indicator ' +
				'cortext-row-drop-indicator--gap' +
				( isActive ? ' is-active' : '' )
			}
			style={ {
				'--cortext-row-drop-line-top': `${ gap.lineOffset }px`,
				position: 'fixed',
				top: `${ gap.rect.top }px`,
				left: `${ gap.rect.left }px`,
				width: `${ gap.rect.width }px`,
				height: `${ gap.rect.height }px`,
			} }
			aria-hidden="true"
		/>
	);
}

/*
 * Grid keeps the old before/after card targets for now. A true 2D gap model
 * needs a separate design pass.
 */
function RowDropZone( { row, zone, activeDrop } ) {
	const data = { rowId: row.rowId, zone };
	const { setNodeRef, isOver } = useDroppable( {
		id: `row-drop:${ row.rowId }:${ zone }`,
		data,
	} );
	const isActive =
		isOver ||
		( activeDrop?.rowId === row.rowId && activeDrop?.zone === zone );
	const top =
		zone === ROW_DROP_BEFORE
			? row.rect.top
			: row.rect.top + row.rect.height / 2;
	const height = Math.max( 8, row.rect.height / 2 );

	return (
		<div
			ref={ setNodeRef }
			className={
				'cortext-row-drop-indicator ' +
				`cortext-row-drop-indicator--${ zone }` +
				( isActive ? ' is-active' : '' )
			}
			style={ {
				position: 'fixed',
				top: `${ top }px`,
				left: `${ row.rect.left }px`,
				width: `${ row.rect.width }px`,
				height: `${ height }px`,
			} }
			aria-hidden="true"
		/>
	);
}

export default function DataViewRowReorder( {
	wrapperRef,
	view,
	onChangeView,
	collectionId,
	rows,
	onReordered,
} ) {
	const renderedRows = useRenderedRows( wrapperRef, view, rows );
	const [ activeRow, setActiveRow ] = useState( null );
	const [ activeDrop, setActiveDrop ] = useState( null );
	const [ visualRow, setVisualRow ] = useState( null );
	const [ visualDrop, setVisualDrop ] = useState( null );
	const [ visualShowActiveRow, setVisualShowActiveRow ] = useState( false );
	const [ settlingOrder, setSettlingOrder ] = useState( null );
	const [ pendingRequest, setPendingRequest ] = useState( null );
	const [ isPosting, setIsPosting ] = useState( false );
	const { createErrorNotice } = useDispatch( noticesStore );
	useRowDisplacement( renderedRows, visualRow, visualDrop, {
		showActiveRow: visualShowActiveRow,
	} );

	const sensors = useSensors(
		useSensor( PointerSensor, {
			activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
		} ),
		useSensor( KeyboardSensor )
	);

	const viewRef = useRef( view );
	viewRef.current = view;
	const rowsRef = useRef( rows );
	rowsRef.current = rows;
	const hoverSuppressionTimeoutRef = useRef( null );
	const noTransitionFrameRef = useRef( null );
	const freezeSafetyTimeoutRef = useRef( null );
	const onChangeViewRef = useRef( onChangeView );
	onChangeViewRef.current = onChangeView;
	const onReorderedRef = useRef( onReordered );
	onReorderedRef.current = onReordered;

	const clearHoverSuppressionTimeout = useCallback( () => {
		if ( hoverSuppressionTimeoutRef.current ) {
			window.clearTimeout( hoverSuppressionTimeoutRef.current );
			hoverSuppressionTimeoutRef.current = null;
		}
	}, [] );

	const clearNoTransitionFrame = useCallback( () => {
		if ( noTransitionFrameRef.current ) {
			window.cancelAnimationFrame( noTransitionFrameRef.current );
			noTransitionFrameRef.current = null;
		}
	}, [] );

	const clearFreezeSafetyTimeout = useCallback( () => {
		if ( freezeSafetyTimeoutRef.current ) {
			window.clearTimeout( freezeSafetyTimeoutRef.current );
			freezeSafetyTimeoutRef.current = null;
		}
	}, [] );

	const suppressRowTransitionsOnce = useCallback( () => {
		clearNoTransitionFrame();
		document.body.classList.add(
			ROW_NO_TRANSITION_CLASS,
			ROW_SUPPRESS_HOVER_CLASS
		);
		noTransitionFrameRef.current = window.requestAnimationFrame( () => {
			noTransitionFrameRef.current = window.requestAnimationFrame( () => {
				noTransitionFrameRef.current = null;
				document.body.classList.remove( ROW_NO_TRANSITION_CLASS );
			} );
		} );
	}, [ clearNoTransitionFrame ] );

	const suppressRowHover = useCallback( () => {
		clearHoverSuppressionTimeout();
		document.body.classList.add( ROW_SUPPRESS_HOVER_CLASS );
	}, [ clearHoverSuppressionTimeout ] );

	const releaseRowHover = useCallback( () => {
		clearHoverSuppressionTimeout();
		hoverSuppressionTimeoutRef.current = window.setTimeout( () => {
			hoverSuppressionTimeoutRef.current = null;
			document.body.classList.remove( ROW_SUPPRESS_HOVER_CLASS );
		}, HOVER_SUPPRESSION_RELEASE_DELAY );
	}, [ clearHoverSuppressionTimeout ] );

	const clearVisualState = useCallback(
		( options = {} ) => {
			clearFreezeSafetyTimeout();
			if ( options.withoutTransition ) {
				suppressRowTransitionsOnce();
			}
			setVisualRow( null );
			setVisualDrop( null );
			setVisualShowActiveRow( false );
			setSettlingOrder( null );
			releaseRowHover();
		},
		[
			clearFreezeSafetyTimeout,
			releaseRowHover,
			suppressRowTransitionsOnce,
		]
	);

	// Keep the dropped position frozen until the refetch brings back the new
	// order, or until the safety timeout gives up. If transition suppression
	// ends while the API is still in flight, a scroll, mutation observer tick,
	// or view change can animate the transforms again and look like a flash.
	const freezeDropState = useCallback(
		( row, drop, expectedOrder ) => {
			clearNoTransitionFrame();
			clearFreezeSafetyTimeout();
			document.body.classList.add(
				ROW_NO_TRANSITION_CLASS,
				ROW_SUPPRESS_HOVER_CLASS
			);
			setActiveRow( null );
			setActiveDrop( null );
			setVisualRow( row );
			setVisualDrop( drop );
			setVisualShowActiveRow( true );
			setSettlingOrder( expectedOrder );
			document.body.classList.remove( ROW_DRAGGING_CLASS );
			freezeSafetyTimeoutRef.current = window.setTimeout( () => {
				freezeSafetyTimeoutRef.current = null;
				clearVisualState( { withoutTransition: true } );
			}, FREEZE_SAFETY_TIMEOUT );
		},
		[ clearFreezeSafetyTimeout, clearNoTransitionFrame, clearVisualState ]
	);

	const performReorder = useCallback(
		async ( request ) => {
			if ( ! collectionId || ! request || isPosting ) {
				return;
			}
			setIsPosting( true );
			try {
				await apiFetch( {
					path: `/cortext/v1/collections/${ collectionId }/rows/${ request.rowId }/reorder`,
					method: 'POST',
					data: {
						before_id: request.before_id,
						after_id: request.after_id,
						current_sort: request.currentSort ?? null,
					},
				} );
				if ( request.clearSortOnSuccess ) {
					onChangeViewRef.current( {
						...( viewRef.current ?? {} ),
						sort: null,
					} );
				}
				onReorderedRef.current?.();
			} catch {
				clearVisualState( { withoutTransition: true } );
				createErrorNotice( __( "Couldn't move the row.", 'cortext' ), {
					id: ROW_REORDER_NOTICE_ID,
					type: 'snackbar',
				} );
			} finally {
				setIsPosting( false );
			}
		},
		[ clearVisualState, collectionId, createErrorNotice, isPosting ]
	);

	const onDragStart = useCallback(
		( event ) => {
			const row = event.active?.data?.current ?? null;
			setActiveRow( row );
			setVisualRow( row );
			setVisualShowActiveRow( false );
			suppressRowHover();
			document.body.classList.add( ROW_DRAGGING_CLASS );
		},
		[ suppressRowHover ]
	);

	const onDragOver = useCallback( ( event ) => {
		const drop = parseDropData( event.over );
		setActiveDrop( drop );
		setVisualDrop( drop );
	}, [] );

	const clearDragState = useCallback(
		( options = {} ) => {
			setActiveRow( null );
			setActiveDrop( null );
			clearVisualState( options );
			document.body.classList.remove( ROW_DRAGGING_CLASS );
		},
		[ clearVisualState ]
	);

	const onDragEnd = useCallback(
		( event ) => {
			const drop = parseDropData( event.over );
			const rowId = event.active?.data?.current?.rowId;
			const reorder = reorderRequestForDrop(
				rowsRef.current,
				rowId,
				drop
			);
			if ( ! reorder ) {
				clearDragState( { withoutTransition: true } );
				return;
			}

			const row = renderedRowFor(
				renderedRows,
				event.active?.data?.current ?? null
			);
			const currentSort = viewRef.current?.sort ?? null;
			const expectedOrder = expectedOrderAfterDrop(
				rowsRef.current,
				rowId,
				drop
			);
			const request = {
				rowId,
				before_id: reorder.before_id,
				after_id: reorder.after_id,
				currentSort,
				row,
				drop,
				expectedOrder,
				clearSortOnSuccess: Boolean( currentSort?.field ),
			};
			const hasExplicitSort =
				Boolean( currentSort?.field ) &&
				currentSort.field !== MANUAL_SORT_ID;

			if ( hasExplicitSort ) {
				clearDragState( { withoutTransition: true } );
				setPendingRequest( request );
				return;
			}

			freezeDropState( row, drop, expectedOrder );
			performReorder( request );
		},
		[ clearDragState, freezeDropState, performReorder, renderedRows ]
	);

	const onDragCancel = useCallback( () => {
		clearDragState();
	}, [ clearDragState ] );

	const onConfirmManualSort = useCallback( () => {
		const request = pendingRequest;
		setPendingRequest( null );
		if ( ! request ) {
			return;
		}
		freezeDropState( request.row, request.drop, request.expectedOrder );
		performReorder( request );
	}, [ freezeDropState, pendingRequest, performReorder ] );

	const onCancelManualSort = useCallback( () => {
		setPendingRequest( null );
		clearVisualState();
	}, [ clearVisualState ] );

	useEffect( () => {
		return () => {
			clearHoverSuppressionTimeout();
			clearNoTransitionFrame();
			clearFreezeSafetyTimeout();
			document.body.classList.remove(
				ROW_DRAGGING_CLASS,
				ROW_SUPPRESS_HOVER_CLASS,
				ROW_NO_TRANSITION_CLASS
			);
		};
	}, [
		clearFreezeSafetyTimeout,
		clearHoverSuppressionTimeout,
		clearNoTransitionFrame,
	] );

	useLayoutEffect( () => {
		if ( sameRowOrder( rowIds( rows ), settlingOrder ) ) {
			clearVisualState( { withoutTransition: true } );
		}
	}, [ clearVisualState, rows, settlingOrder ] );

	if ( renderedRows.length === 0 ) {
		return null;
	}

	const renderLinearGaps = usesLinearGaps( view );
	const rowGaps = renderLinearGaps
		? linearRowGaps( renderedRows, activeRow )
		: [];

	return (
		<DndContext
			sensors={ sensors }
			collisionDetection={ rowCollisionDetection }
			onDragStart={ onDragStart }
			onDragOver={ onDragOver }
			onDragEnd={ onDragEnd }
			onDragCancel={ onDragCancel }
			autoScroll={ false }
		>
			{ renderedRows.map( ( row ) => (
				<RowDragHandle
					key={ `row-handle:${ row.rowId }` }
					row={ row }
				/>
			) ) }
			{ renderLinearGaps
				? rowGaps.map( ( gap ) => (
						<RowGapDropZone
							key={ `gap:${ gap.index }` }
							gap={ gap }
							activeDrop={ activeDrop }
						/>
				  ) )
				: renderedRows.flatMap( ( row ) => [
						<RowDropZone
							key={ `before:${ row.rowId }` }
							row={ row }
							zone={ ROW_DROP_BEFORE }
							activeDrop={ activeDrop }
						/>,
						<RowDropZone
							key={ `after:${ row.rowId }` }
							row={ row }
							zone={ ROW_DROP_AFTER }
							activeDrop={ activeDrop }
						/>,
				  ] ) }
			<DragOverlay
				dropAnimation={ null }
				zIndex={ ROW_DRAG_OVERLAY_Z_INDEX }
			>
				{ activeRow ? <RowDragPreview row={ activeRow } /> : null }
			</DragOverlay>
			{ pendingRequest ? (
				<ConfirmDialog
					onConfirm={ onConfirmManualSort }
					onCancel={ onCancelManualSort }
					confirmButtonText={ __( 'Keep this order', 'cortext' ) }
				>
					<p>
						{ __(
							'This will clear the current sort and keep rows where you drop them.',
							'cortext'
						) }
					</p>
				</ConfirmDialog>
			) : null }
		</DndContext>
	);
}
