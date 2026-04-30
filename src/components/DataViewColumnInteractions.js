import { __ } from '@wordpress/i18n';
import {
	createPortal,
	useCallback,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';

import {
	MAX_COLUMN_WIDTH,
	TITLE_FIELD_ID,
	getMinWidth,
	withColumnOrder,
	withColumnWidth,
} from './dataViewColumns';

const TABLE_SELECTOR = '.dataviews-view-table';
const HEADER_CELLS_SELECTOR = '.dataviews-view-table thead > tr > th';
// `@wordpress/dataviews` uses these classes for the bulk-select and per-row
// actions columns. We aren't passing `actions` or `selection` props to
// `<DataViews>`, so neither column should appear in our case — but we still
// filter them out so the field-to-th index mapping stays robust if the
// library starts rendering an extra `<th>` later.
const SKIP_HEADER_CLASSES = [
	'dataviews-view-table__checkbox-column',
	'dataviews-view-table__actions-column',
];

// Pointer movement (px) that distinguishes a click from a drag. Mirrors the
// dnd-kit PointerSensor distance constraint we use elsewhere; below this,
// the column-header menu trigger fires normally.
const DRAG_ACTIVATION_DISTANCE = 5;

function findHeaderCells( wrapper, view ) {
	const table = wrapper?.querySelector( TABLE_SELECTOR );
	if ( ! table ) {
		return [];
	}
	const fields = Array.isArray( view?.fields ) ? view.fields : [];
	const cells = Array.from(
		table.querySelectorAll( HEADER_CELLS_SELECTOR )
	).filter(
		( th ) =>
			! SKIP_HEADER_CLASSES.some( ( cls ) =>
				th.classList.contains( cls )
			)
	);
	return fields
		.map( ( fieldId, index ) => {
			const el = cells[ index ];
			return el ? { fieldId, index, el } : null;
		} )
		.filter( Boolean );
}

function useHeaderCells( wrapperRef, view ) {
	const [ cells, setCells ] = useState( [] );
	const cellsRef = useRef( cells );
	cellsRef.current = cells;

	useEffect( () => {
		const wrapper = wrapperRef.current;
		if ( ! wrapper ) {
			return;
		}

		// Compare by element identity and field id so unchanged scans don't
		// rerender the portal layer.
		const sync = () => {
			const next = findHeaderCells( wrapper, view );
			const prev = cellsRef.current;
			const same =
				next.length === prev.length &&
				next.every(
					( cell, i ) =>
						cell.el === prev[ i ].el &&
						cell.fieldId === prev[ i ].fieldId
				);
			if ( ! same ) {
				setCells( next );
			}
		};

		sync();

		const observer = new window.MutationObserver( sync );
		observer.observe( wrapper, { childList: true, subtree: true } );
		return () => observer.disconnect();
	}, [ wrapperRef, view ] );

	return cells;
}

function ColumnResizer( { fieldId, headerEl, view, onChangeView } ) {
	const minWidth = getMinWidth( fieldId );

	const onPointerDown = useCallback(
		( event ) => {
			if ( event.button !== 0 ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();

			const startX = event.clientX;
			const startWidth = headerEl.getBoundingClientRect().width;
			const handle = event.currentTarget;
			// Pointer capture re-targets pointermove/pointerup for this
			// pointerId to the handle, even if the pointer leaves the iframe
			// or the viewport. Without it, dragging past the editor canvas
			// loses the pointer mid-resize.
			handle.setPointerCapture?.( event.pointerId );
			headerEl.classList.add( 'cortext-column-resizing' );
			document.body.classList.add( 'cortext-column-resizing' );

			const computeWidth = ( clientX ) => {
				const next = startWidth + ( clientX - startX );
				return Math.max(
					minWidth,
					Math.min( MAX_COLUMN_WIDTH, Math.round( next ) )
				);
			};

			const onPointerMove = ( moveEvent ) => {
				// Direct DOM mutation during the drag: the library's render
				// pass writes inline width from `view.layout.styles`, but
				// it isn't running while the pointer is held — so writing
				// `style.width` here gives live feedback without churning
				// React state on every frame. The pointerup commit through
				// `onChangeView` lets the next render take over.
				const nextWidth = computeWidth( moveEvent.clientX );
				headerEl.style.width = `${ nextWidth }px`;
			};

			const onPointerUp = ( upEvent ) => {
				handle.removeEventListener( 'pointermove', onPointerMove );
				handle.removeEventListener( 'pointerup', onPointerUp );
				handle.removeEventListener( 'pointercancel', onPointerUp );
				handle.releasePointerCapture?.( upEvent.pointerId );
				headerEl.classList.remove( 'cortext-column-resizing' );
				document.body.classList.remove( 'cortext-column-resizing' );
				const nextWidth = computeWidth( upEvent.clientX );
				onChangeView( withColumnWidth( view, fieldId, nextWidth ) );
			};

			handle.addEventListener( 'pointermove', onPointerMove );
			handle.addEventListener( 'pointerup', onPointerUp );
			handle.addEventListener( 'pointercancel', onPointerUp );
		},
		[ fieldId, headerEl, minWidth, onChangeView, view ]
	);

	return (
		<div
			className="cortext-column-resizer"
			role="separator"
			aria-orientation="vertical"
			aria-label={ __( 'Resize column', 'cortext' ) }
			onPointerDown={ onPointerDown }
		/>
	);
}

function ColumnDragHandle( {
	index,
	view,
	onChangeView,
	cellsRef,
	wrapperRef,
	setDropTarget,
} ) {
	const onPointerDown = useCallback(
		( event ) => {
			if ( event.button !== 0 ) {
				return;
			}
			const startX = event.clientX;
			const startY = event.clientY;
			const handle = event.currentTarget;
			let dragging = false;

			const computeTargetIndex = ( clientX ) => {
				const cells = cellsRef.current;
				for ( let i = 0; i < cells.length; i += 1 ) {
					const rect = cells[ i ].el.getBoundingClientRect();
					if ( clientX < rect.left + rect.width / 2 ) {
						return i;
					}
				}
				return cells.length - 1;
			};

			const computeIndicator = ( targetIndex ) => {
				const wrapper = wrapperRef.current;
				const cells = cellsRef.current;
				if ( ! wrapper || cells.length === 0 ) {
					return null;
				}
				const wrapperRect = wrapper.getBoundingClientRect();
				const headRect = cells[ 0 ].el.getBoundingClientRect();
				let leftPx;
				if ( targetIndex >= cells.length ) {
					const lastRect =
						cells[ cells.length - 1 ].el.getBoundingClientRect();
					leftPx = lastRect.right - wrapperRect.left;
				} else {
					const rect =
						cells[ targetIndex ].el.getBoundingClientRect();
					leftPx = rect.left - wrapperRect.left;
				}
				return {
					left: leftPx,
					top: headRect.top - wrapperRect.top,
					height: headRect.height,
				};
			};

			// Pointer capture so the drag tracks even when the cursor leaves
			// the iframe / viewport. We capture on pointerdown rather than at
			// the activation threshold because the captured element receives
			// subsequent pointermove events directly.
			handle.setPointerCapture?.( event.pointerId );

			const onPointerMove = ( moveEvent ) => {
				const dx = moveEvent.clientX - startX;
				const dy = moveEvent.clientY - startY;
				if (
					! dragging &&
					Math.hypot( dx, dy ) < DRAG_ACTIVATION_DISTANCE
				) {
					return;
				}
				if ( ! dragging ) {
					dragging = true;
					document.body.classList.add( 'cortext-column-dragging' );
				}
				const targetIndex = computeTargetIndex( moveEvent.clientX );
				const indicator = computeIndicator( targetIndex );
				if ( indicator ) {
					setDropTarget( { ...indicator, targetIndex } );
				}
			};

			const onPointerUp = ( upEvent ) => {
				handle.removeEventListener( 'pointermove', onPointerMove );
				handle.removeEventListener( 'pointerup', onPointerUp );
				handle.removeEventListener( 'pointercancel', onPointerUp );
				handle.releasePointerCapture?.( upEvent.pointerId );
				document.body.classList.remove( 'cortext-column-dragging' );
				setDropTarget( null );
				if ( ! dragging ) {
					return;
				}
				const targetIndex = computeTargetIndex( upEvent.clientX );
				if ( targetIndex === index ) {
					return;
				}
				onChangeView( withColumnOrder( view, index, targetIndex ) );
			};

			handle.addEventListener( 'pointermove', onPointerMove );
			handle.addEventListener( 'pointerup', onPointerUp );
			handle.addEventListener( 'pointercancel', onPointerUp );
		},
		[ cellsRef, index, onChangeView, setDropTarget, view, wrapperRef ]
	);

	return (
		<button
			type="button"
			className="cortext-column-drag-handle"
			aria-label={ __( 'Reorder column', 'cortext' ) }
			onPointerDown={ onPointerDown }
		/>
	);
}

export default function DataViewColumnInteractions( {
	wrapperRef,
	view,
	onChangeView,
} ) {
	const cells = useHeaderCells( wrapperRef, view );
	const cellsRef = useRef( cells );
	cellsRef.current = cells;
	const [ dropTarget, setDropTarget ] = useState( null );

	if ( cells.length === 0 ) {
		return null;
	}

	return (
		<>
			{ cells.map( ( { fieldId, index, el } ) => {
				const isTitle = fieldId === TITLE_FIELD_ID;
				return createPortal(
					<>
						{ ! isTitle && (
							<ColumnDragHandle
								index={ index }
								view={ view }
								onChangeView={ onChangeView }
								cellsRef={ cellsRef }
								wrapperRef={ wrapperRef }
								setDropTarget={ setDropTarget }
							/>
						) }
						{ ! isTitle && (
							<ColumnResizer
								fieldId={ fieldId }
								headerEl={ el }
								view={ view }
								onChangeView={ onChangeView }
							/>
						) }
					</>,
					el,
					fieldId
				);
			} ) }
			{ dropTarget && (
				<div
					className="cortext-column-drop-indicator"
					style={ {
						left: `${ dropTarget.left }px`,
						top: `${ dropTarget.top }px`,
						height: `${ dropTarget.height }px`,
					} }
					aria-hidden="true"
				/>
			) }
		</>
	);
}
