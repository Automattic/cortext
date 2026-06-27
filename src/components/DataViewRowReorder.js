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

import './DataViewRowReorder.scss';

import RowDragHandle from './RowDragHandle';

const DRAG_ACTIVATION_DISTANCE = 5;
const ROW_REORDER_NOTICE_ID = 'cortext-row-reorder-failed';
const MANUAL_SORT_ID = 'manual';
const ROW_DRAG_OVERLAY_Z_INDEX = 100002;
const ROW_DISPLACED_CLASS = 'cortext-row-reorder-target--displaced';
const ROW_ACTIVE_CLASS = 'cortext-row-reorder-target--active';
const ROW_DROP_GAP = 'gap';
const ROW_DROP_ITEM = 'item';
const ROW_DRAGGING_CLASS = 'cortext-row-dragging';
const ROW_SUPPRESS_HOVER_CLASS = 'cortext-row-reorder-suppress-hover';
const ROW_NO_TRANSITION_CLASS = 'cortext-row-reorder-no-transition';
const ADD_FIELD_ID = '__add_field';
// Reserves room on the right of the preview for the sticky actions cell.
// The cell is about 88px in DataViews; 48 lets the last field breathe on
// wide rows while keeping the preview tight on short ones. Bump it if the
// actions cell ever grows.
const ROW_ACTIONS_CHROME_RESERVE = 48;
// Half-height limit for a gap drop zone above or below the seam between
// two rows. The cap needs to cover normal balanced/comfortable rows, or
// their middle band has no droppable and the preview snaps back to the
// source. Very tall rows still get capped so their body doesn't become one
// huge between-rows target.
const ROW_DROP_ZONE_MAX_SIDE = 40;
const HOVER_SUPPRESSION_RELEASE_DELAY = 120;

// tech-debt.md#td-dataviews-row-reorder: DataViews doesn't expose row refs or reorder hooks.
// Keep the DOM selectors for this adapter in one place.
const ROW_SELECTORS = {
	table: '.dataviews-view-table tbody > tr',
	list: [
		'.dataviews-view-list > [role="row"]',
		'.dataviews-view-list > li',
		'.dataviews-view-list > .dataviews-view-list__item',
	].join( ',' ),
	grid: '.dataviews-view-grid__row__gridcell.dataviews-view-grid__card:not(.dataviews-view-grid__placeholder)',
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
	// DataViews tags the actions column with the two classes below. The third
	// check (last cell that has a button) catches the few frames during a
	// re-render where neither class has landed yet; we read the live DOM, so
	// a missing class shows up as a missing cell. None of our schema fields
	// render a bare button straight inside their td, so false positives
	// aren't really a worry here.
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

function measureRowCells( allCells ) {
	return allCells.map( ( cell ) => ( {
		cell,
		rect: cell.getBoundingClientRect(),
		isCheckbox: isCheckboxTableCell( cell ),
		isKnownActions: isActionsTableCell( cell ),
	} ) );
}

function rectIntersectsViewport( rect, containerRect ) {
	if ( ! containerRect ) {
		return true;
	}
	return rect.right > containerRect.left && rect.left < containerRect.right;
}

// Returns the horizontal box the field cells have to fit into and whether
// the preview needs room on the right for the sticky actions cell. The
// trailing-utility branch catches actions cells that haven't picked up
// their class yet but are already taking a slot past the last
// `view.fields` entry.
function computeContentBounds(
	measuredCells,
	containerRect,
	expectedFieldCount
) {
	const intersects = ( rect ) =>
		rectIntersectsViewport( rect, containerRect );
	const hasActionsChrome = measuredCells.some(
		( info ) => info.isKnownActions
	);
	const actionsLeft = measuredCells.reduce( ( left, info ) => {
		if (
			info.isKnownActions &&
			info.rect.width > 0 &&
			intersects( info.rect )
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
				intersects( info.rect )
		).length > expectedFieldCount;
	const needsActionsReserve =
		Boolean( containerRect ) &&
		( hasActionsChrome || hasTrailingUtilityCell );
	const reservedRight = needsActionsReserve
		? containerRect.right - ROW_ACTIONS_CHROME_RESERVE
		: containerRect?.right ?? Infinity;
	return {
		intersects,
		contentLeft: containerRect?.left ?? -Infinity,
		contentRight: Math.min(
			reservedRight,
			Number.isFinite( actionsLeft ) ? actionsLeft : Infinity
		),
		trailingSpacerRight: needsActionsReserve
			? Math.round( containerRect.right )
			: null,
	};
}

function clipRectToContainer( rect, containerRect ) {
	if ( ! containerRect ) {
		return {
			left: Math.round( rect.left ),
			right: Math.round( rect.right ),
			width: Math.round( rect.width ),
		};
	}
	const left = Math.round( Math.max( rect.left, containerRect.left ) );
	const right = Math.round( Math.min( rect.right, containerRect.right ) );
	return { left, right, width: Math.max( 0, right - left ) };
}

// Tags every visible cell as field/checkbox/actions and clips its rect to
// the container, keeping the original row order. Skips off-screen cells,
// zero-width cells, and any non-utility cell that runs past the content
// bounds (the reserved sticky actions slot lives there), so the preview
// stops at the chrome instead of bleeding into it.
function selectVisibleCells(
	measuredCells,
	bounds,
	containerRect,
	expectedFieldCount
) {
	const fieldLimit = expectedFieldCount ?? Infinity;
	const fitsContent = ( rect ) =>
		rect.left >= bounds.contentLeft && rect.right <= bounds.contentRight;
	const visible = [];
	let fieldCellsSeen = 0;
	for ( const info of measuredCells ) {
		const { cell, rect, isCheckbox, isKnownActions } = info;
		if ( rect.width <= 0 || ! bounds.intersects( rect ) ) {
			continue;
		}
		const isField =
			! isCheckbox && ! isKnownActions && fieldCellsSeen < fieldLimit;
		// Drop fields that overflow the reserved content zone and also drop
		// unknown trailing cells (fields beyond `view.fields`) so they don't
		// crowd the actions chrome.
		if ( ! isCheckbox && ! isKnownActions && ! fitsContent( rect ) ) {
			continue;
		}
		if ( isField ) {
			fieldCellsSeen += 1;
		}
		const clipped = clipRectToContainer( rect, containerRect );
		if ( clipped.width <= 0 ) {
			continue;
		}
		visible.push( {
			cell,
			clipped,
			isCheckbox,
			isActions: isKnownActions || ( ! isCheckbox && ! isField ),
			isField,
		} );
	}
	return visible;
}

// Walks the visible cells left to right and drops a spacer wherever two of
// them left a horizontal gap (a hidden field, or a sticky cell that jumped
// position). The final spacer fills the actions reserve so the preview
// ends flush with the container's right edge.
function interleavePreviewCells( visibleCells, trailingSpacerRight ) {
	const previewCells = [];
	let cursor = null;
	let primaryAssigned = false;
	for ( const info of visibleCells ) {
		const { left, right, width } = info.clipped;
		if ( cursor !== null && left > cursor ) {
			previewCells.push( { width: left - cursor, isSpacer: true } );
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
	if (
		cursor !== null &&
		trailingSpacerRight !== null &&
		trailingSpacerRight > cursor
	) {
		previewCells.push( {
			width: trailingSpacerRight - cursor,
			isSpacer: true,
		} );
	}
	return previewCells;
}

function rowPreviewCells( rowElement, layout, row, view ) {
	const label = rowLabel( row );
	if ( layout === 'grid' ) {
		return [ { source: rowElement, text: label, isGridCard: true } ];
	}
	if ( layout === 'list' ) {
		return [ { source: rowElement, text: label, isListRow: true } ];
	}
	if ( layout !== 'table' ) {
		return [ { text: label } ];
	}

	const measuredCells = measureRowCells( tableCells( rowElement ) );
	const expectedFieldCount = visibleFieldCount( view );
	const containerRect =
		rowViewportContainer( rowElement )?.getBoundingClientRect() ?? null;
	const bounds = computeContentBounds(
		measuredCells,
		containerRect,
		expectedFieldCount
	);
	const visible = selectVisibleCells(
		measuredCells,
		bounds,
		containerRect,
		expectedFieldCount
	);
	const previewCells = interleavePreviewCells(
		visible,
		bounds.trailingSpacerRight
	);
	return previewCells.length ? previewCells : [ { text: label } ];
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
	return cells
		.map( ( cell ) =>
			cell.isGridCard || cell.isListRow
				? `${ cell.text }:${
						cell.source?.querySelectorAll( 'img' ).length ?? 0
				  }`
				: cell.text
		)
		.join( '\u0000' );
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

function removeGridPreviewChrome( node ) {
	removePreviewChrome( node );
	node.querySelectorAll(
		'.dataviews-selection-checkbox, .dataviews-view-grid__media-actions'
	).forEach( ( child ) => {
		child.remove();
	} );
}

function removeListPreviewChrome( node ) {
	removePreviewChrome( node );
	node.querySelectorAll( '.dataviews-view-list__item' ).forEach(
		( child ) => {
			const gridCell = child.parentElement?.matches( '[role="gridcell"]' )
				? child.parentElement
				: child;
			gridCell.remove();
		}
	);
	node.querySelectorAll(
		'.dataviews-selection-checkbox, .dataviews-view-list__item-actions'
	).forEach( ( child ) => {
		child.remove();
	} );
}

function resetPreviewDragState( node ) {
	node.classList.remove(
		ROW_ACTIVE_CLASS,
		ROW_DISPLACED_CLASS,
		ROW_NO_TRANSITION_CLASS,
		ROW_SUPPRESS_HOVER_CLASS,
		ROW_DRAGGING_CLASS,
		'is-hovered',
		'is-selected'
	);
	node.style.removeProperty( 'transform' );
	node.style.removeProperty( 'transition' );
	node.style.removeProperty( 'visibility' );
}

function normalizeClonedCellContent( node ) {
	node.querySelectorAll(
		'.dataviews-view-table__cell-content-wrapper'
	).forEach( ( child ) => {
		child.classList.add( 'cortext-row-drag-preview__cell-content-wrapper' );
	} );
}

function cloneGridCardPreview( source ) {
	const previewCard = source.ownerDocument.createElement( 'div' );
	previewCard.className =
		'cortext-row-drag-preview__grid-card dataviews-view-grid__card';

	for ( const child of Array.from( source.childNodes ) ) {
		previewCard.appendChild( child.cloneNode( true ) );
	}

	resetPreviewDragState( previewCard );
	previewCard.querySelectorAll( '*' ).forEach( resetPreviewDragState );
	removeGridPreviewChrome( previewCard );
	removePreviewInteractivity( previewCard );
	removeClonedIds( previewCard );
	return previewCard;
}

function cloneListRowPreview( source ) {
	const previewRow = source.cloneNode( true );
	previewRow.classList.add( 'cortext-row-drag-preview__list-row' );

	resetPreviewDragState( previewRow );
	previewRow.querySelectorAll( '*' ).forEach( resetPreviewDragState );
	removeListPreviewChrome( previewRow );
	removePreviewInteractivity( previewRow );
	removeClonedIds( previewRow );
	return previewRow;
}

function appendPlainPreviewContent( node, cells ) {
	for ( const [ index, cell ] of cells.entries() ) {
		if ( cell.isGridCard && cell.source ) {
			node.appendChild( cloneGridCardPreview( cell.source ) );
			continue;
		}
		if ( cell.isListRow && cell.source ) {
			node.appendChild( cloneListRowPreview( cell.source ) );
			continue;
		}

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
	const isGridCard = row.previewLayout === 'grid';
	const isListRow = row.previewLayout === 'list';
	const usesSourceShape = isGridCard || isListRow;

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
			className={
				`cortext-row-drag-preview cortext-row-drag-preview--${ density }` +
				( isGridCard ? ' cortext-row-drag-preview--grid-card' : '' ) +
				( isListRow ? ' cortext-row-drag-preview--list-row' : '' )
			}
			style={ {
				width: `${ width }px`,
				...( usesSourceShape && row.previewHeight
					? { height: `${ row.previewHeight }px` }
					: {} ),
			} }
			aria-label={ row.label }
		/>
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
				previewHeight:
					layout === 'grid' || layout === 'list' ? rect.height : null,
				previewLayout: layout,
				previewDensity: previewDensity( el, view ),
				el,
				handleEl,
				rect,
			};
		} )
		.filter( Boolean );
}

function useRenderedRows( wrapperRef, view, rows, isDragging ) {
	const [ renderedRows, setRenderedRows ] = useState( [] );
	const renderedRowsRef = useRef( renderedRows );
	renderedRowsRef.current = renderedRows;
	const decoratedRowsRef = useRef( [] );
	const decoratedCellsRef = useRef( [] );
	const supportsLayout = supportsRowReorder( view );
	// Keep row measurements fixed during a drag. Moving rows toggles classes as
	// the drop target changes; if the MutationObserver runs `sync()` in the
	// middle of that transition, `rowRect` can read a half-animated rect and save
	// bad gap positions. The table layout should not change while the pointer is
	// down, so keep the snapshot from drag start.
	const isDraggingRef = useRef( isDragging );
	isDraggingRef.current = isDragging;

	useEffect( () => {
		const wrapper = wrapperRef.current;
		if ( ! wrapper || ! supportsLayout ) {
			return undefined;
		}

		let frame = null;
		const sync = () => {
			if ( frame || isDraggingRef.current ) {
				return;
			}
			frame = window.requestAnimationFrame( () => {
				frame = null;
				// A sync queued just before drag start can still fire after the
				// pointer is down. Ignore it so the snapshot stays put.
				if ( isDraggingRef.current ) {
					return;
				}
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
		observer.observe( wrapper, {
			childList: true,
			subtree: true,
		} );
		// Pull `ResizeObserver` from the wrapper's window so the block editor
		// iframe uses its own constructor. We watch both the outer wrapper
		// and DataViews' inner scroller: the preview width comes from the
		// inner scroller, but the outer one moves whenever the embedding
		// block resizes. If `.dataviews-wrapper` mounts later (lazy
		// hydration, for example), MutationObserver above re-runs `sync` but
		// doesn't re-attach the ResizeObserver. DataViews mounts that wrapper
		// on first paint today, so a late remount is the next thing to chase
		// if this breaks.
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
		// `window` is the parent frame, but the wrapper lives in the editor
		// canvas iframe, which scrolls on its own. The parent never sees that
		// scroll, so without the iframe listeners below the gap snapshot keeps
		// its pre-scroll positions: the first drag onto a table lower down
		// finds the fixed drop zones sitting the scroll distance below the
		// rows, with nothing under the pointer. Later drags re-sync, so only
		// the first one misses.
		const ownerWindow = wrapper.ownerDocument?.defaultView;
		const watchesOwnerWindow = ownerWindow && ownerWindow !== window;
		if ( watchesOwnerWindow ) {
			ownerWindow.addEventListener( 'scroll', sync, true );
			ownerWindow.addEventListener( 'resize', sync );
		}

		// Leave decoration classes in place between subscriptions. Sort changes
		// and refetches can re-run this effect during the drop freeze; removing
		// `cortext-row-reorder-cell` here collapses the drag-handle offset for
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
			if ( watchesOwnerWindow ) {
				ownerWindow.removeEventListener( 'scroll', sync, true );
				ownerWindow.removeEventListener( 'resize', sync );
			}
		};
	}, [ wrapperRef, view, rows, supportsLayout ] );

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

function parseDropData( over, renderedRows = [], activeRowId = null ) {
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
	if ( data?.type === ROW_DROP_ITEM ) {
		const targetId = Number( data.rowId );
		const activeId = Number( activeRowId );
		const ids = renderedRows.map( ( row ) => row.rowId );
		const targetIndex = ids.indexOf( targetId );
		const activeIndex = ids.indexOf( activeId );
		if (
			! targetId ||
			! activeId ||
			targetId === activeId ||
			targetIndex === -1 ||
			activeIndex === -1
		) {
			return null;
		}

		const insertionIndex =
			targetIndex > activeIndex ? targetIndex + 1 : targetIndex;
		return {
			type: ROW_DROP_GAP,
			insertionIndex,
			beforeId: renderedRows[ insertionIndex ]?.rowId ?? null,
			afterId: renderedRows[ insertionIndex - 1 ]?.rowId ?? null,
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

function displacementForDrop( renderedRows, activeRow, activeDrop, view ) {
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

	if ( usesGridItems( view ) ) {
		for ( const [ index, row ] of nextRows.entries() ) {
			const targetRect = renderedRows[ index ]?.rect;
			if ( ! targetRect ) {
				continue;
			}

			const offset = {
				x: Math.round( targetRect.left - row.rect.left ),
				y: Math.round( targetRect.top - row.rect.top ),
			};

			if ( row.rowId === activeId ) {
				activeOffset = offset.x || offset.y ? offset : null;
			} else if ( offset.x || offset.y ) {
				offsets.set( row.rowId, offset );
			}
		}
		return { activeId, activeOffset, offsets };
	}

	// Stack heights as we go instead of borrowing
	// `renderedRows[index].rect.top`. Rows can have different heights (an
	// expanded editor cell next to collapsed ones, for instance), so the
	// row sitting at `index` right now may not be where the moved row will
	// end up.
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

// Optimistic reorder over the raw `data` array (not `dataFiltered`). `drop`
// is the gap descriptor with `beforeId`/`afterId` referencing rows visible in
// the filtered list. We insert next to whichever neighbour exists in `data`,
// preserving rows the active filter hides. Falls through if either anchor is
// missing from `data` (paginated edge case): the refetch will reconcile.
function reorderDataByDrop( data, rowId, drop ) {
	if ( ! Array.isArray( data ) || ! rowId || drop?.type !== ROW_DROP_GAP ) {
		return null;
	}
	const draggedId = Number( rowId );
	const dragged = data.find( ( r ) => Number( r?.id ) === draggedId );
	if ( ! dragged ) {
		return null;
	}
	const without = data.filter( ( r ) => Number( r?.id ) !== draggedId );
	const beforeId = drop.beforeId ? Number( drop.beforeId ) : null;
	const afterId = drop.afterId ? Number( drop.afterId ) : null;
	let insertAt;
	if ( afterId ) {
		const idx = without.findIndex( ( r ) => Number( r?.id ) === afterId );
		insertAt = idx === -1 ? null : idx + 1;
	} else if ( beforeId ) {
		const idx = without.findIndex( ( r ) => Number( r?.id ) === beforeId );
		insertAt = idx === -1 ? null : idx;
	} else {
		insertAt = null;
	}
	if ( insertAt === null ) {
		return null;
	}
	return [
		...without.slice( 0, insertAt ),
		dragged,
		...without.slice( insertAt ),
	];
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

function useRowDisplacement( renderedRows, activeRow, activeDrop, view ) {
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

		const { activeId, offsets } = displacementForDrop(
			renderedRows,
			activeRow,
			activeDrop,
			view
		);
		const changedRows = [];
		const changedElements = new Set();
		const pendingTransforms = [];
		const rowsNeedingFlush = [];

		for ( const row of renderedRows ) {
			if ( row.rowId === activeId ) {
				row.el.classList.add( ROW_ACTIVE_CLASS );
				row.el.classList.remove( ROW_DISPLACED_CLASS );
				row.el.style.removeProperty( 'transform' );
				changedRows.push( row.el );
				changedElements.add( row.el );
			} else {
				row.el.classList.remove( ROW_ACTIVE_CLASS );
			}

			const offset = offsets.get( row.rowId );
			if ( offset ) {
				if ( ! row.el.style.transform ) {
					row.el.style.transform = 'translate3d(0, 0, 0)';
					rowsNeedingFlush.push( row.el );
				}
				pendingTransforms.push( [ row.el, rowTransform( offset ) ] );
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
	}, [ activeDrop, activeRow, renderedRows, view ] );

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

function usesGridItems( view ) {
	return view?.type === 'grid';
}

function supportsRowReorder( view ) {
	return usesLinearGaps( view ) || usesGridItems( view );
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
		const top = after
			? Math.max( rawTop, lineTop - ROW_DROP_ZONE_MAX_SIDE )
			: lineTop - ROW_DROP_ZONE_MAX_SIDE;
		const bottom = before
			? Math.min( rawBottom, lineTop + ROW_DROP_ZONE_MAX_SIDE )
			: lineTop + ROW_DROP_ZONE_MAX_SIDE;
		const tableContainerRect = anchor.el?.closest( '.dataviews-view-table' )
			? rowViewportContainer( anchor.el )?.getBoundingClientRect?.()
			: null;
		const left =
			tableContainerRect?.width > 0
				? tableContainerRect.left
				: Math.min(
						after?.rect.left ?? anchor.rect.left,
						before?.rect.left ?? anchor.rect.left
				  );
		const right =
			tableContainerRect?.width > 0
				? tableContainerRect.right
				: Math.max(
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

function gridRowItems( renderedRows, activeRow ) {
	const activeId = Number( activeRow?.rowId );
	return renderedRows.filter( ( row ) => row.rowId !== activeId );
}

function RowItemDropZone( { row } ) {
	const { setNodeRef, isOver } = useDroppable( {
		id: `row-item:${ row.rowId }`,
		data: {
			type: ROW_DROP_ITEM,
			rowId: row.rowId,
		},
	} );

	return (
		<div
			ref={ setNodeRef }
			className={
				'cortext-row-drop-indicator ' +
				'cortext-row-drop-indicator--card' +
				( isOver ? ' is-active' : '' )
			}
			style={ {
				position: 'fixed',
				top: `${ row.rect.top }px`,
				left: `${ row.rect.left }px`,
				width: `${ row.rect.width }px`,
				height: `${ row.rect.height }px`,
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
	data,
	mutateRows,
	onReordered,
} ) {
	const [ activeRow, setActiveRow ] = useState( null );
	const renderedRows = useRenderedRows(
		wrapperRef,
		view,
		rows,
		activeRow !== null
	);
	const [ activeDrop, setActiveDrop ] = useState( null );
	const [ visualRow, setVisualRow ] = useState( null );
	const [ visualDrop, setVisualDrop ] = useState( null );
	const [ pendingRequest, setPendingRequest ] = useState( null );
	const [ isPosting, setIsPosting ] = useState( false );
	const { createErrorNotice } = useDispatch( noticesStore );
	useRowDisplacement( renderedRows, visualRow, visualDrop, view );

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
	const dataRef = useRef( data );
	dataRef.current = data;
	const mutateRowsRef = useRef( mutateRows );
	mutateRowsRef.current = mutateRows;
	const pendingRefreshAfterSortClearRef = useRef( false );
	const hoverSuppressionTimeoutRef = useRef( null );
	const noTransitionFrameRef = useRef( null );
	const onChangeViewRef = useRef( onChangeView );
	onChangeViewRef.current = onChangeView;
	const onReorderedRef = useRef( onReordered );
	onReorderedRef.current = onReordered;

	// The wrapper lives in the editor canvas iframe, but the rest of the
	// component (and `document` itself) runs in the parent window. Body
	// classes that gate row transitions and hover suppression must land
	// in the iframe document so they share scope with the row elements;
	// otherwise the CSS selector `body.cortext-row-dragging
	// .cortext-row-reorder-target` never matches and rows snap instead
	// of animating. Cache the resolved body so unmount cleanup can still
	// reach the iframe body after `wrapperRef.current` clears.
	const reorderBodyRef = useRef( null );
	const getReorderBody = useCallback( () => {
		const body = wrapperRef.current?.ownerDocument?.body ?? document.body;
		reorderBodyRef.current = body;
		return body;
	}, [ wrapperRef ] );

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

	const suppressRowTransitionsOnce = useCallback( () => {
		clearNoTransitionFrame();
		getReorderBody().classList.add(
			ROW_NO_TRANSITION_CLASS,
			ROW_SUPPRESS_HOVER_CLASS
		);
		noTransitionFrameRef.current = window.requestAnimationFrame( () => {
			noTransitionFrameRef.current = window.requestAnimationFrame( () => {
				noTransitionFrameRef.current = null;
				getReorderBody().classList.remove( ROW_NO_TRANSITION_CLASS );
			} );
		} );
	}, [ clearNoTransitionFrame, getReorderBody ] );

	const suppressRowHover = useCallback( () => {
		clearHoverSuppressionTimeout();
		getReorderBody().classList.add( ROW_SUPPRESS_HOVER_CLASS );
	}, [ clearHoverSuppressionTimeout, getReorderBody ] );

	const releaseRowHover = useCallback( () => {
		clearHoverSuppressionTimeout();
		hoverSuppressionTimeoutRef.current = window.setTimeout( () => {
			hoverSuppressionTimeoutRef.current = null;
			getReorderBody().classList.remove( ROW_SUPPRESS_HOVER_CLASS );
		}, HOVER_SUPPRESSION_RELEASE_DELAY );
	}, [ clearHoverSuppressionTimeout, getReorderBody ] );

	const clearVisualState = useCallback(
		( options = {} ) => {
			if ( options.withoutTransition ) {
				suppressRowTransitionsOnce();
			}
			setVisualRow( null );
			setVisualDrop( null );
			releaseRowHover();
		},
		[ releaseRowHover, suppressRowTransitionsOnce ]
	);

	const flushRefreshAfterSortClear = useCallback( () => {
		if ( ! pendingRefreshAfterSortClearRef.current ) {
			return;
		}
		const currentSort = viewRef.current?.sort ?? null;
		const hasExplicitSort =
			Boolean( currentSort?.field ) &&
			currentSort.field !== MANUAL_SORT_ID;
		if ( hasExplicitSort ) {
			return;
		}
		pendingRefreshAfterSortClearRef.current = false;
		onReorderedRef.current?.();
	}, [] );

	useEffect( () => {
		flushRefreshAfterSortClear();
	}, [
		flushRefreshAfterSortClear,
		view?.sort?.direction,
		view?.sort?.field,
	] );

	// Posts the reorder to the server. On failure restores `data` from the
	// snapshot taken before the optimistic mutation, and (if we cleared a
	// non-manual sort to make the move visible) restores that sort too.
	const performReorder = useCallback(
		async ( request ) => {
			if ( ! collectionId || ! request || isPosting ) {
				return;
			}
			setIsPosting( true );
			try {
				await apiFetch( {
					// The reorder endpoint derives the parent collection from
					// the row's trait term, so the row id is the only path
					// param needed.
					path: `/cortext/v1/documents/${ request.rowId }/reorder`,
					method: 'POST',
					data: {
						before_id: request.before_id,
						after_id: request.after_id,
						current_sort: request.currentSort ?? null,
					},
				} );
				if ( request.refreshAfterSortClear ) {
					pendingRefreshAfterSortClearRef.current = true;
					flushRefreshAfterSortClear();
				} else {
					onReorderedRef.current?.();
				}
			} catch {
				if ( request.previousData && mutateRowsRef.current ) {
					mutateRowsRef.current( request.previousData );
				}
				if ( request.previousSort !== undefined ) {
					onChangeViewRef.current( {
						...( viewRef.current ?? {} ),
						sort: request.previousSort,
					} );
				}
				createErrorNotice(
					__( "Couldn't move the document.", 'cortext' ),
					{
						id: ROW_REORDER_NOTICE_ID,
						type: 'snackbar',
					}
				);
			} finally {
				setIsPosting( false );
			}
		},
		[
			collectionId,
			createErrorNotice,
			flushRefreshAfterSortClear,
			isPosting,
		]
	);

	const onDragStart = useCallback(
		( event ) => {
			const row = event.active?.data?.current ?? null;
			setActiveRow( row );
			setVisualRow( row );
			suppressRowHover();
			getReorderBody().classList.add( ROW_DRAGGING_CLASS );
		},
		[ suppressRowHover, getReorderBody ]
	);

	const onDragOver = useCallback(
		( event ) => {
			const drop = parseDropData(
				event.over,
				renderedRows,
				event.active?.data?.current?.rowId
			);
			setActiveDrop( drop );
			setVisualDrop( drop );
		},
		[ renderedRows ]
	);

	const clearDragState = useCallback(
		( options = {} ) => {
			setActiveRow( null );
			setActiveDrop( null );
			clearVisualState( options );
			getReorderBody().classList.remove( ROW_DRAGGING_CLASS );
		},
		[ clearVisualState, getReorderBody ]
	);

	// Builds the request and applies an optimistic mutation so the user sees
	// the new order before the API answers. If the active sort would hide the
	// move (anything other than manual), pass it through the confirm dialog
	// first; we clear the sort and snapshot it for rollback on failure.
	const commitReorder = useCallback(
		( request, { clearSort } = {} ) => {
			const previousData = dataRef.current;
			const previousSort = viewRef.current?.sort ?? null;
			const nextData = reorderDataByDrop(
				previousData,
				request.rowId,
				request.drop
			);
			if ( ! nextData || ! mutateRowsRef.current ) {
				clearDragState( { withoutTransition: true } );
				return;
			}
			clearDragState( { withoutTransition: true } );
			mutateRowsRef.current( nextData );
			if ( clearSort ) {
				onChangeViewRef.current( {
					...( viewRef.current ?? {} ),
					sort: null,
				} );
			}
			performReorder( {
				...request,
				previousData,
				...( clearSort
					? { previousSort, refreshAfterSortClear: true }
					: {} ),
			} );
		},
		[ clearDragState, performReorder ]
	);

	const onDragEnd = useCallback(
		( event ) => {
			const rowId = event.active?.data?.current?.rowId;
			const drop = parseDropData( event.over, renderedRows, rowId );
			const reorder = reorderRequestForDrop(
				rowsRef.current,
				rowId,
				drop
			);
			if ( ! reorder ) {
				clearDragState( { withoutTransition: true } );
				return;
			}

			const currentSort = viewRef.current?.sort ?? null;
			const hasExplicitSort =
				Boolean( currentSort?.field ) &&
				currentSort.field !== MANUAL_SORT_ID;
			const request = {
				rowId,
				before_id: reorder.before_id,
				after_id: reorder.after_id,
				currentSort,
				drop,
			};

			if ( hasExplicitSort ) {
				clearDragState( { withoutTransition: true } );
				setPendingRequest( request );
				return;
			}

			commitReorder( request, { clearSort: false } );
		},
		[ clearDragState, commitReorder, renderedRows ]
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
		commitReorder( request, { clearSort: true } );
	}, [ commitReorder, pendingRequest ] );

	const onCancelManualSort = useCallback( () => {
		setPendingRequest( null );
		clearVisualState();
	}, [ clearVisualState ] );

	useEffect( () => {
		return () => {
			clearHoverSuppressionTimeout();
			clearNoTransitionFrame();
			// `wrapperRef.current` is likely null at unmount, so reach for
			// the cached body the drag handlers used.
			( reorderBodyRef.current ?? document.body ).classList.remove(
				ROW_DRAGGING_CLASS,
				ROW_SUPPRESS_HOVER_CLASS,
				ROW_NO_TRANSITION_CLASS
			);
		};
	}, [ clearHoverSuppressionTimeout, clearNoTransitionFrame ] );

	if ( ! supportsRowReorder( view ) || renderedRows.length === 0 ) {
		return null;
	}

	const rowGaps = usesLinearGaps( view )
		? linearRowGaps( renderedRows, activeRow )
		: [];
	const rowItems = usesGridItems( view )
		? gridRowItems( renderedRows, activeRow )
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
					keyboardFocusable={ view?.type !== 'list' }
					activateFromRow={ usesGridItems( view ) }
				/>
			) ) }
			{ rowGaps.map( ( gap ) => (
				<RowGapDropZone
					key={ `gap:${ gap.index }` }
					gap={ gap }
					activeDrop={ activeDrop }
				/>
			) ) }
			{ rowItems.map( ( row ) => (
				<RowItemDropZone
					key={ `row-item:${ row.rowId }` }
					row={ row }
				/>
			) ) }
			<DragOverlay zIndex={ ROW_DRAG_OVERLAY_Z_INDEX }>
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
							'Documents will stay where you dropped them, and the current sort will be cleared.',
							'cortext'
						) }
					</p>
				</ConfirmDialog>
			) : null }
		</DndContext>
	);
}
