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
const ADD_FIELD_ID = '__add_field';
// Width to reserve at the right of the preview for the sticky actions column.
// DataViews' actions cell measures ~88px in practice; 48 is enough so the last
// field never sits flush against the actions affordance, without leaving a
// jarring empty strip on rows with short content. Bump this if DataViews ever
// widens the actions chrome and the preview starts crowding it.
const ROW_ACTIONS_CHROME_RESERVE = 48;
// Maximum half-height of a gap drop zone above/below the seam between two
// rows. Without this cap, tall rows produce gap hitboxes that span half the
// row -- meaning a drop near the middle of the row would activate the gap.
// 24px keeps the hitbox aimable but bounded.
const ROW_DROP_ZONE_MAX_SIDE = 24;
const HOVER_SUPPRESSION_RELEASE_DELAY = 120;
const FREEZE_SAFETY_TIMEOUT = 3000;

// tech-debt.md#49: DataViews doesn't expose row refs or reorder hooks.
// Keep the DOM selectors for this adapter in one place. Grid stays out for now;
// card-to-card drops need a separate 2D design.
const ROW_SELECTORS = {
	table: '.dataviews-view-table tbody > tr',
	list: [
		'.dataviews-view-list__item',
		'.dataviews-view-list li',
		'.dataviews-view-list [role="row"]',
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
				item.previewWidth === b[ index ]?.previewWidth &&
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

function rowViewportContainer( rowElement ) {
	return (
		rowElement.closest( '.dataviews-wrapper' ) ??
		rowElement.closest( '.cortext-data-view' )
	);
}

function renderedRowRect( rowElement, layout ) {
	const rect = rowRect( rowElement );
	if ( layout !== 'table' ) {
		return rect;
	}

	const containerRect =
		rowViewportContainer( rowElement )?.getBoundingClientRect?.();
	if ( ! containerRect?.width ) {
		return rect;
	}

	const rowLeft = rect.left;
	const rowRight = rect.left + rect.width;
	const left = Math.max( rowLeft, Math.round( containerRect.left ) );
	const right = Math.min( rowRight, Math.round( containerRect.right ) );

	return {
		...rect,
		left: Math.round( left ),
		width: Math.max( 0, Math.round( right - left ) ),
	};
}

function normalizePreviewText( text ) {
	return text.replace( /\s+/g, ' ' ).trim();
}

function tableCells( rowElement ) {
	return Array.from( rowElement.children ).filter( ( child ) =>
		child.matches( 'td, th' )
	);
}

function isCheckboxTableCell( cell ) {
	return cell.classList.contains( 'dataviews-view-table__checkbox-column' );
}

function isActionsTableCell( cell ) {
	// DataViews labels the actions column with the two upstream classes below.
	// The third check (last cell containing a button) is a fallback for the
	// brief moments when the column hasn't picked up its sticky modifier yet
	// during re-renders, since the preview is built off the live DOM. Schema
	// fields never render a bare `<button>` directly inside their `<td>` in
	// this codebase, so the false-positive risk is bounded.
	return (
		cell.classList.contains( 'dataviews-view-table__actions-column' ) ||
		cell.classList.contains(
			'dataviews-view-table__actions-column--sticky'
		) ||
		( cell === cell.parentElement?.lastElementChild &&
			Boolean( cell.querySelector( 'button' ) ) )
	);
}

function isUtilityTableCell( cell ) {
	return isCheckboxTableCell( cell ) || isActionsTableCell( cell );
}

function visibleFieldCount( view ) {
	if ( ! Array.isArray( view?.fields ) ) {
		return null;
	}

	const count = view.fields.filter(
		( fieldId ) => fieldId && fieldId !== ADD_FIELD_ID
	).length;
	return count > 0 ? count : null;
}

function tableHandleTarget( rowElement ) {
	const cells = tableCells( rowElement ).filter(
		( cell ) => ! isUtilityTableCell( cell )
	);

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

function rowPreviewCells( rowElement, layout, row, view ) {
	const label = rowLabel( row );
	if ( layout === 'table' ) {
		const allCells = tableCells( rowElement );
		const expectedFieldCount = visibleFieldCount( view );
		const container = rowViewportContainer( rowElement );
		const containerRect = container?.getBoundingClientRect() ?? null;
		const intersectsViewport = ( rect ) => {
			if ( ! containerRect ) {
				return true;
			}
			return (
				rect.right > containerRect.left &&
				rect.left < containerRect.right
			);
		};
		const measuredCells = allCells.map( ( cell ) => ( {
			cell,
			rect: cell.getBoundingClientRect(),
			isCheckbox: isCheckboxTableCell( cell ),
			isKnownActions: isActionsTableCell( cell ),
		} ) );
		const hasActionsChrome = measuredCells.some(
			( info ) => info.isKnownActions
		);
		const actionsLeft = measuredCells.reduce( ( left, info ) => {
			if (
				info.isKnownActions &&
				info.rect.width > 0 &&
				intersectsViewport( info.rect )
			) {
				return Math.min( left, info.rect.left );
			}
			return left;
		}, Infinity );
		const hasTrailingUtilityCell =
			expectedFieldCount !== null &&
			measuredCells.filter(
				( info ) =>
					! info.isCheckbox &&
					info.rect.width > 0 &&
					intersectsViewport( info.rect )
			).length > expectedFieldCount;
		const reservedRight =
			containerRect && ( hasActionsChrome || hasTrailingUtilityCell )
				? containerRect.right - ROW_ACTIONS_CHROME_RESERVE
				: containerRect?.right ?? Infinity;
		const contentRight = Math.min(
			reservedRight,
			Number.isFinite( actionsLeft ) ? actionsLeft : Infinity
		);
		const contentLeft = containerRect?.left ?? -Infinity;
		const fitsContentViewport = ( rect ) =>
			rect.left >= contentLeft && rect.right <= contentRight;

		const clipToContainer = ( rect ) => {
			if ( ! containerRect ) {
				return {
					left: Math.round( rect.left ),
					right: Math.round( rect.right ),
					width: Math.round( rect.width ),
				};
			}

			const left = Math.round(
				Math.max( rect.left, containerRect.left )
			);
			const right = Math.round(
				Math.min( rect.right, containerRect.right )
			);
			return {
				left,
				right,
				width: Math.max( 0, right - left ),
			};
		};

		const cells = [];
		let fieldCellsSeen = 0;
		const fieldLimit = expectedFieldCount ?? Infinity;
		for ( const info of measuredCells ) {
			const { cell, rect, isCheckbox, isKnownActions } = info;
			if ( rect.width <= 0 || ! intersectsViewport( rect ) ) {
				continue;
			}
			const isField =
				! isCheckbox && ! isKnownActions && fieldCellsSeen < fieldLimit;
			if ( isField && ! fitsContentViewport( rect ) ) {
				continue;
			}
			if (
				! isField &&
				! isCheckbox &&
				! isKnownActions &&
				! fitsContentViewport( rect )
			) {
				continue;
			}
			if ( isField ) {
				fieldCellsSeen += 1;
			}
			const clipped = clipToContainer( rect );
			if ( clipped.width <= 0 ) {
				continue;
			}
			cells.push( {
				cell,
				rect,
				clipped,
				isCheckbox,
				isActions: isKnownActions || ( ! isCheckbox && ! isField ),
				isField,
			} );
		}

		const previewCells = [];
		let cursor = null;
		let primaryAssigned = false;
		for ( const info of cells ) {
			const { left, right, width } = info.clipped;
			if ( cursor !== null && left > cursor ) {
				previewCells.push( {
					width: left - cursor,
					isSpacer: true,
				} );
			}

			const isPrimary = info.isField && ! primaryAssigned;
			if ( isPrimary ) {
				primaryAssigned = true;
			}
			previewCells.push( {
				source: info.cell,
				text: normalizePreviewText( info.cell.textContent ?? '' ),
				width,
				isPrimary,
				isCheckbox: info.isCheckbox,
				isActions: info.isActions,
			} );
			cursor = cursor === null ? right : Math.max( cursor, right );
		}
		const previewRight =
			containerRect && ( hasActionsChrome || hasTrailingUtilityCell )
				? Math.round( containerRect.right )
				: null;
		if (
			cursor !== null &&
			previewRight !== null &&
			previewRight > cursor
		) {
			previewCells.push( {
				width: previewRight - cursor,
				isSpacer: true,
			} );
		}

		return previewCells.length ? previewCells : [ { text: label } ];
	}

	return [ { text: label } ];
}

function rowPreviewWidth( rowElement, layout, rect ) {
	if ( layout === 'table' ) {
		const container = rowViewportContainer( rowElement );
		const width = container?.getBoundingClientRect?.().width;
		if ( width > 0 ) {
			return Math.round( width );
		}
	}

	return Math.round( rect?.width ?? 0 ) || null;
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
		const isPrimary = cell.isPrimary ?? index === 0;
		cellElement.className =
			'cortext-row-drag-preview__cell' +
			( isPrimary ? ' cortext-row-drag-preview__cell--primary' : '' ) +
			( cell.isCheckbox
				? ' cortext-row-drag-preview__cell--checkbox'
				: '' ) +
			( cell.isActions
				? ' cortext-row-drag-preview__cell--actions'
				: '' ) +
			( cell.isSpacer ? ' cortext-row-drag-preview__cell--spacer' : '' );
		if ( cell.width ) {
			cellElement.style.flex = `0 0 ${ cell.width }px`;
		}
		if ( cell.source && ! cell.isActions ) {
			for ( const child of Array.from( cell.source.childNodes ) ) {
				cellElement.appendChild( child.cloneNode( true ) );
			}
			removePreviewChrome( cellElement );
			removePreviewInteractivity( cellElement );
			removeClonedIds( cellElement );
			normalizeClonedCellContent( cellElement );
		}
		if (
			! cell.source &&
			! cell.isSpacer &&
			! normalizePreviewText( cellElement.textContent ?? '' )
		) {
			cellElement.textContent = cell.text;
		}
		node.appendChild( cellElement );
	}
}

function RowDragPreview( { row } ) {
	const previewRef = useRef( null );
	// The table row can be much wider than the visible block because DataViews
	// keeps scrolled-out cells in the DOM. Use the measured wrapper width when
	// we have it, then fall back to the generated cells.
	const cellsWidth = ( row.previewCells ?? [] ).reduce(
		( width, cell ) => width + ( cell.width || 0 ),
		0
	);
	const width = Math.max( row.previewWidth ?? cellsWidth, 240 );
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
			const rect = renderedRowRect( el, layout );
			const handleEl = handleTargetFor( el, layout );
			const previewCells = rowPreviewCells( el, layout, row, view );
			return {
				rowId: Number( row.id ),
				index,
				label: rowLabel( row ),
				previewCells,
				previewSignature: rowPreviewSignature( previewCells ),
				previewWidth: rowPreviewWidth( el, layout, rect ),
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
	const isLinear = usesLinearGaps( view );

	useEffect( () => {
		const wrapper = wrapperRef.current;
		if ( ! wrapper || ! isLinear ) {
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
		const ResizeObserverConstructor =
			wrapper.ownerDocument?.defaultView?.ResizeObserver;
		const resizeObserver = ResizeObserverConstructor
			? new ResizeObserverConstructor( sync )
			: null;
		resizeObserver?.observe( wrapper );
		const dataviewsWrapper = wrapper.querySelector( '.dataviews-wrapper' );
		if ( dataviewsWrapper ) {
			resizeObserver?.observe( dataviewsWrapper );
		}
		wrapper.addEventListener( 'scroll', sync, true );
		window.addEventListener( 'resize', sync );
		window.addEventListener( 'scroll', sync, true );

		// Leave decoration classes in place between subscriptions. Sort changes
		// and refetches can re-run this effect during the drop freeze; removing
		// `cortext-row-reorder-cell` here collapses the 24px handle padding for
		// one frame. sync() handles rows that leave the set, and the unmount
		// effect below does the final cleanup.
		return () => {
			if ( frame ) {
				window.cancelAnimationFrame( frame );
			}
			observer.disconnect();
			resizeObserver?.disconnect();
			wrapper.removeEventListener( 'scroll', sync, true );
			window.removeEventListener( 'resize', sync );
			window.removeEventListener( 'scroll', sync, true );
		};
	}, [ wrapperRef, view, rows, isLinear ] );

	useEffect( () => {
		return () => {
			for ( const el of decoratedRowsRef.current ) {
				el.classList.remove( 'cortext-row-reorder-target' );
			}
			for ( const el of decoratedCellsRef.current ) {
				el.classList.remove( 'cortext-row-reorder-cell' );
			}
			decoratedRowsRef.current = [];
			decoratedCellsRef.current = [];
		};
	}, [] );

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
	return null;
}

function rowCollisionDetection( args ) {
	if ( args.pointerCoordinates ) {
		return pointerWithin( args );
	}

	return closestCenter( args );
}

function insertionIndexForDrop( ids, activeDrop ) {
	if ( activeDrop?.type !== ROW_DROP_GAP ) {
		return null;
	}
	return activeDrop.insertionIndex >= 0 &&
		activeDrop.insertionIndex <= ids.length
		? activeDrop.insertionIndex
		: null;
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

	let targetTop = renderedRows[ 0 ]?.rect.top ?? 0;
	for ( const [ index, row ] of nextRows.entries() ) {
		if ( ! renderedRows[ index ] ) {
			continue;
		}

		const offset = {
			x: 0,
			y: Math.round( targetTop - row.rect.top ),
		};
		targetTop += row.rect.height;

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
		const rawTop = after
			? after.rect.top + after.rect.height / 2
			: before.rect.top;
		const rawBottom = before
			? before.rect.top + before.rect.height / 2
			: after.rect.top + after.rect.height;
		const lineTop = before
			? before.rect.top
			: after.rect.top + after.rect.height;
		const top = Math.max( rawTop, lineTop - ROW_DROP_ZONE_MAX_SIDE );
		const bottom = Math.min( rawBottom, lineTop + ROW_DROP_ZONE_MAX_SIDE );
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

	// Hold the dropped position until the refetch confirms the new order.
	// This order matters: remove the body class that enables row transitions
	// before `useRowDisplacement` applies the placed transform. Otherwise the
	// active row animates from its old position for one frame after drop.
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

	// Skip grid for now. In a 2D layout, dropping onto a card does not tell us
	// exactly where the row should land.
	if ( ! usesLinearGaps( view ) || renderedRows.length === 0 ) {
		return null;
	}

	const rowGaps = linearRowGaps( renderedRows, activeRow );

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
			{ rowGaps.map( ( gap ) => (
				<RowGapDropZone
					key={ `gap:${ gap.index }` }
					gap={ gap }
					activeDrop={ activeDrop }
				/>
			) ) }
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
							'Rows will stay where you dropped them, and the current sort will be cleared.',
							'cortext'
						) }
					</p>
				</ConfirmDialog>
			) : null }
		</DndContext>
	);
}
