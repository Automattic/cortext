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

// Pointer movement (px) that distinguishes a click from a drag. Below this
// threshold, the column-header menu trigger fires normally; past it, we take
// over and reorder.
const DRAG_ACTIVATION_DISTANCE = 5;

function fieldTypeFor( fieldId, fieldsById ) {
	if ( fieldId === TITLE_FIELD_ID ) {
		return 'title';
	}
	return fieldsById.get( fieldId )?.type;
}

function findHeaderCells( wrapper, view, fieldsById ) {
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
			if ( ! el ) {
				return null;
			}
			return {
				fieldId,
				fieldType: fieldTypeFor( fieldId, fieldsById ),
				index,
				el,
			};
		} )
		.filter( Boolean );
}

function useHeaderCells( wrapperRef, view, fields ) {
	const [ cells, setCells ] = useState( [] );
	const cellsRef = useRef( cells );
	cellsRef.current = cells;

	useEffect( () => {
		const wrapper = wrapperRef.current;
		if ( ! wrapper ) {
			return;
		}

		const fieldsById = new Map(
			( fields ?? [] ).map( ( field ) => [ field.id, field ] )
		);

		// Compare by element identity and field id so unchanged scans don't
		// rerender the portal layer.
		const sync = () => {
			const next = findHeaderCells( wrapper, view, fieldsById );
			const prev = cellsRef.current;
			const same =
				next.length === prev.length &&
				next.every(
					( cell, i ) =>
						cell.el === prev[ i ].el &&
						cell.fieldId === prev[ i ].fieldId &&
						cell.fieldType === prev[ i ].fieldType
				);
			if ( ! same ) {
				setCells( next );
			}
		};

		sync();

		const observer = new window.MutationObserver( sync );
		observer.observe( wrapper, { childList: true, subtree: true } );
		return () => observer.disconnect();
	}, [ wrapperRef, view, fields ] );

	return cells;
}

// Attaches a native `pointerdown` listener to each header `<th>` so the
// entire header is the drag area. Clicks (no movement) bubble through to the
// library's column-header menu trigger; drags past the activation distance
// take over, show the drop indicator, and on release commit the reorder
// while suppressing the click that would otherwise open the menu.
function useHeaderDrag( {
	cells,
	viewRef,
	onChangeViewRef,
	wrapperRef,
	setDropTarget,
} ) {
	useEffect( () => {
		if ( cells.length === 0 ) {
			return undefined;
		}

		const cellsList = cells;

		const computeTargetIndex = ( clientX ) => {
			for ( let i = 0; i < cellsList.length; i += 1 ) {
				const rect = cellsList[ i ].el.getBoundingClientRect();
				if ( clientX < rect.left + rect.width / 2 ) {
					return i;
				}
			}
			return cellsList.length - 1;
		};

		const computeIndicator = ( targetIndex ) => {
			const wrapper = wrapperRef.current;
			if ( ! wrapper || cellsList.length === 0 ) {
				return null;
			}
			const wrapperRect = wrapper.getBoundingClientRect();
			const headRect = cellsList[ 0 ].el.getBoundingClientRect();
			let leftPx;
			if ( targetIndex >= cellsList.length ) {
				const lastRect =
					cellsList[
						cellsList.length - 1
					].el.getBoundingClientRect();
				leftPx = lastRect.right - wrapperRect.left;
			} else {
				const rect =
					cellsList[ targetIndex ].el.getBoundingClientRect();
				leftPx = rect.left - wrapperRect.left;
			}
			return {
				left: leftPx,
				top: headRect.top - wrapperRect.top,
				height: headRect.height,
			};
		};

		const removers = cellsList.map( ( cell ) => {
			const handler = ( event ) => {
				if ( event.button !== 0 ) {
					return;
				}
				// Don't intercept pointerdowns that originate inside the
				// resize handle — the resizer owns its own drag.
				if ( event.target?.closest?.( '.cortext-column-resizer' ) ) {
					return;
				}

				const startX = event.clientX;
				const startY = event.clientY;
				const fromIndex = cell.index;
				const headerEl = cell.el;
				let dragging = false;

				headerEl.setPointerCapture?.( event.pointerId );

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
						document.body.classList.add(
							'cortext-column-dragging'
						);
					}
					const targetIndex = computeTargetIndex( moveEvent.clientX );
					const indicator = computeIndicator( targetIndex );
					if ( indicator ) {
						setDropTarget( { ...indicator, targetIndex } );
					}
				};

				const onPointerUp = ( upEvent ) => {
					headerEl.removeEventListener(
						'pointermove',
						onPointerMove
					);
					headerEl.removeEventListener( 'pointerup', onPointerUp );
					headerEl.removeEventListener(
						'pointercancel',
						onPointerUp
					);
					headerEl.releasePointerCapture?.( upEvent.pointerId );
					document.body.classList.remove( 'cortext-column-dragging' );
					setDropTarget( null );

					if ( ! dragging ) {
						// Just a click; let the menu trigger fire normally.
						return;
					}

					// After a drag, the browser still fires `click` on the
					// element under the pointer. Swallow it once so the
					// menu doesn't pop open immediately after a reorder.
					const suppressClick = ( clickEvent ) => {
						clickEvent.preventDefault();
						clickEvent.stopPropagation();
						window.removeEventListener(
							'click',
							suppressClick,
							true
						);
					};
					window.addEventListener( 'click', suppressClick, true );
					// Belt-and-suspenders: if no click ever fires (because
					// the pointer was released outside any clickable
					// element), drop the listener on the next tick.
					setTimeout( () => {
						window.removeEventListener(
							'click',
							suppressClick,
							true
						);
					}, 0 );

					const targetIndex = computeTargetIndex( upEvent.clientX );
					if ( targetIndex === fromIndex ) {
						return;
					}
					onChangeViewRef.current(
						withColumnOrder(
							viewRef.current,
							fromIndex,
							targetIndex
						)
					);
				};

				headerEl.addEventListener( 'pointermove', onPointerMove );
				headerEl.addEventListener( 'pointerup', onPointerUp );
				headerEl.addEventListener( 'pointercancel', onPointerUp );
			};

			cell.el.addEventListener( 'pointerdown', handler );
			return () => cell.el.removeEventListener( 'pointerdown', handler );
		} );

		return () => {
			for ( const remove of removers ) {
				remove();
			}
		};
	}, [ cells, onChangeViewRef, setDropTarget, viewRef, wrapperRef ] );
}

function ColumnResizer( { fieldId, fieldType, headerEl, view, onChangeView } ) {
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
			const minWidth = getMinWidth( fieldType );
			// Pointer capture re-targets pointermove/pointerup for this
			// pointerId to the handle, even if the pointer leaves the iframe
			// or the viewport. Without it, dragging past the editor canvas
			// loses the pointer mid-resize.
			handle.setPointerCapture?.( event.pointerId );
			headerEl.classList.add( 'cortext-column-resizing' );
			document.body.classList.add( 'cortext-column-resizing' );

			// Find every cell in this column so the live drag mutates body
			// `<td>`s alongside the header. Under `table-layout: auto` the
			// column's width is the max of all cells' widths — constraining
			// only the th leaves the column visually wide until commit, so
			// the user sees no movement during the drag in tables where
			// body content is wider than the header.
			const tableEl = headerEl.closest( '.dataviews-view-table' );
			const headerSiblings = headerEl.parentElement
				? Array.from( headerEl.parentElement.children )
				: [];
			const colIndex = headerSiblings.indexOf( headerEl );
			const bodyCells =
				colIndex >= 0 && tableEl
					? tableEl.querySelectorAll(
							`tbody > tr > *:nth-child(${ colIndex + 1 })`
					  )
					: [];

			const computeWidth = ( clientX ) => {
				const next = startWidth + ( clientX - startX );
				return Math.max(
					minWidth,
					Math.min( MAX_COLUMN_WIDTH, Math.round( next ) )
				);
			};

			const applyLiveWidth = ( px ) => {
				headerEl.style.width = px;
				headerEl.style.maxWidth = px;
				for ( const td of bodyCells ) {
					td.style.width = px;
					td.style.maxWidth = px;
				}
			};

			const onPointerMove = ( moveEvent ) => {
				// Direct DOM mutation during the drag: the library's render
				// pass writes inline width from `view.layout.styles`, but
				// it isn't running while the pointer is held. Writing
				// `style.width` and `style.maxWidth` here on every cell in
				// the column gives live feedback without churning React
				// state on every frame; the pointerup commit through
				// `onChangeView` lets the next render take over and the
				// inline styles get overwritten by the library's render.
				const nextWidth = computeWidth( moveEvent.clientX );
				applyLiveWidth( `${ nextWidth }px` );
			};

			const onPointerUp = ( upEvent ) => {
				handle.removeEventListener( 'pointermove', onPointerMove );
				handle.removeEventListener( 'pointerup', onPointerUp );
				handle.removeEventListener( 'pointercancel', onPointerUp );
				handle.releasePointerCapture?.( upEvent.pointerId );
				headerEl.classList.remove( 'cortext-column-resizing' );
				document.body.classList.remove( 'cortext-column-resizing' );
				const nextWidth = computeWidth( upEvent.clientX );
				onChangeView(
					withColumnWidth( view, fieldId, nextWidth, fieldType )
				);
			};

			handle.addEventListener( 'pointermove', onPointerMove );
			handle.addEventListener( 'pointerup', onPointerUp );
			handle.addEventListener( 'pointercancel', onPointerUp );
		},
		[ fieldId, fieldType, headerEl, onChangeView, view ]
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

export default function DataViewColumnInteractions( {
	wrapperRef,
	view,
	fields,
	onChangeView,
} ) {
	const cells = useHeaderCells( wrapperRef, view, fields );
	const [ dropTarget, setDropTarget ] = useState( null );

	// Refs let the pointerdown handlers see the latest view + onChangeView
	// without re-attaching on every block render.
	const viewRef = useRef( view );
	viewRef.current = view;
	const onChangeViewRef = useRef( onChangeView );
	onChangeViewRef.current = onChangeView;

	useHeaderDrag( {
		cells,
		viewRef,
		onChangeViewRef,
		wrapperRef,
		setDropTarget,
	} );

	if ( cells.length === 0 ) {
		return null;
	}

	return (
		<>
			{ cells.map( ( { fieldId, fieldType, el } ) =>
				createPortal(
					<ColumnResizer
						fieldId={ fieldId }
						fieldType={ fieldType }
						headerEl={ el }
						view={ view }
						onChangeView={ onChangeView }
					/>,
					el,
					fieldId
				)
			) }
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
