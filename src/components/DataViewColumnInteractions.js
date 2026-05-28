import { __ } from '@wordpress/i18n';
import {
	createPortal,
	useCallback,
	useEffect,
	useRef,
	useState,
} from '@wordpress/element';
import {
	DndContext,
	DragOverlay,
	PointerSensor,
	pointerWithin,
	useDraggable,
	useDroppable,
	useSensor,
	useSensors,
} from '@dnd-kit/core';

import './DataViewColumnInteractions.scss';

import {
	GHOST_FIELD_ID,
	MAX_COLUMN_WIDTH,
	TITLE_FIELD_ID,
	clampWidth,
	getMinWidth,
	withColumnOrder,
	withColumnWidth,
} from './dataViewColumns';

const TABLE_SELECTOR = '.dataviews-view-table';
const HEADER_CELLS_SELECTOR = '.dataviews-view-table thead > tr > th';
// tech-debt.md#td-dataviews-column-interactions: DataViews doesn't expose stable table-column refs. This
// adapter maps `view.fields` onto rendered `<th>` elements and filters out
// library-owned utility columns so resize/reorder controls stay aligned.
const SKIP_HEADER_CLASSES = [
	'dataviews-view-table__checkbox-column',
	'dataviews-view-table__actions-column',
];

// Pointer movement (px) that distinguishes a click from a drag. Below this
// threshold, dnd-kit leaves the column-header menu trigger alone.
const DRAG_ACTIVATION_DISTANCE = 5;
const HEADER_BUTTON_SELECTOR = '.dataviews-view-table-header-button';

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
			// Skip the ghost "+ add field" column: empty content means
			// no width to resize, and reordering the trailing add-field
			// affordance would be confusing.
			if ( fieldId === GHOST_FIELD_ID ) {
				return null;
			}
			// Prefer the field's own label over the cell's textContent
			// for the drag preview. Custom field columns render their
			// label asynchronously (via `useEntityRecord`), so the cell
			// can briefly contain only the fallback `field-<id>` text.
			const fieldLabel = fieldsById.get( fieldId )?.label;
			return {
				fieldId,
				fieldType: fieldTypeFor( fieldId, fieldsById ),
				index,
				label: fieldLabel || el.textContent?.trim() || fieldId,
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

function getColumnBodyCells( headerEl ) {
	const tableEl = headerEl.closest( TABLE_SELECTOR );
	const headerSiblings = headerEl.parentElement
		? Array.from( headerEl.parentElement.children )
		: [];
	const colIndex = headerSiblings.indexOf( headerEl );
	if ( colIndex < 0 || ! tableEl ) {
		return [];
	}
	return Array.from(
		tableEl.querySelectorAll(
			`tbody > tr > *:nth-child(${ colIndex + 1 })`
		)
	);
}

// Buffer added to autofit measurements (px). Browsers can render text at
// fractional pixel widths, and the copied measurement and live render don't
// always round the same way; a couple of pixels of slack keeps proportional
// digit widths (`2007` is wider than `1939`) from clipping after autofit.
const AUTOFIT_PADDING_BUFFER = 2;

function measureCellNaturalWidth( cell ) {
	const sourceTable = cell.closest( TABLE_SELECTOR );
	const isHeader = cell.tagName === 'TH';
	const table = document.createElement( 'table' );
	const section = document.createElement( isHeader ? 'thead' : 'tbody' );
	const row = document.createElement( 'tr' );
	const clone = cell.cloneNode( true );

	clone.querySelector( '.cortext-column-resizer' )?.remove();
	clone.removeAttribute( 'style' );
	clone.style.width = 'auto';
	clone.style.minWidth = '0';
	clone.style.maxWidth = 'none';

	// Copy the rendered table's classes (including `has-*-density`) so the
	// per-density padding rules apply to the measurement copy too.
	table.className = sourceTable?.className ?? '';
	table.style.width = 'auto';
	table.style.tableLayout = 'auto';

	row.appendChild( clone );
	section.appendChild( row );
	table.appendChild( section );

	// Wrap the copy in `.cortext-data-view` and a real `<tbody>` / `<thead>`
	// so our scoped overrides match it. Without those ancestors the upstream
	// `min-width: 15ch` floor on `.dataviews-view-table__cell-content-wrapper`
	// leaks back in and every column measures at least ~15 characters wide.
	// `display: block` keeps the measurement table out of any flex layout.
	const wrapper = document.createElement( 'div' );
	wrapper.className = 'cortext-data-view';
	wrapper.style.position = 'fixed';
	wrapper.style.left = '-10000px';
	wrapper.style.top = '0';
	wrapper.style.visibility = 'hidden';
	wrapper.style.pointerEvents = 'none';
	wrapper.style.display = 'block';
	wrapper.appendChild( table );

	// Append next to the live table so the copy inherits the same fonts and
	// tokens. Body inheritance differs from `.cortext-root` shell font on the
	// SPA path, and the mismatch produced widths the live render couldn't fit.
	const measurementHost = sourceTable?.parentNode ?? document.body;
	measurementHost.appendChild( wrapper );

	// `getBoundingClientRect` is border-box; `style.width = px` writes as
	// content-box on `<th>` / `<td>`. Subtract the cell's own padding and
	// border so the persisted width round-trips through render at the size we
	// measured. Without this, each autofit grew the column by the chrome on
	// every double-click.
	const bbox = clone.getBoundingClientRect();
	const styles = window.getComputedStyle( clone );
	const chrome =
		( Number.parseFloat( styles.paddingLeft ) || 0 ) +
		( Number.parseFloat( styles.paddingRight ) || 0 ) +
		( Number.parseFloat( styles.borderLeftWidth ) || 0 ) +
		( Number.parseFloat( styles.borderRightWidth ) || 0 );
	wrapper.remove();

	return Math.max( 0, bbox.width - chrome );
}

function getAutoFitColumnWidth( headerEl, fieldType, fieldId ) {
	const cells = [ headerEl, ...getColumnBodyCells( headerEl ) ];
	const naturalWidth = Math.max(
		...cells.map( ( cell ) => measureCellNaturalWidth( cell ) )
	);
	return clampWidth(
		naturalWidth + AUTOFIT_PADDING_BUFFER,
		fieldType,
		fieldId
	);
}

function applyColumnWidth( headerEl, width ) {
	const px = `${ width }px`;
	headerEl.style.width = px;
	headerEl.style.maxWidth = px;
	for ( const td of getColumnBodyCells( headerEl ) ) {
		td.style.width = px;
		td.style.maxWidth = px;
	}
}

function getColumnStyleWidth( headerEl ) {
	const inlineWidth = Number.parseFloat( headerEl.style.width );
	if ( Number.isFinite( inlineWidth ) ) {
		return inlineWidth;
	}

	const styles = window.getComputedStyle( headerEl );
	const rect = headerEl.getBoundingClientRect();
	if ( styles.boxSizing === 'border-box' ) {
		return rect.width;
	}

	const horizontalExtras =
		Number.parseFloat( styles.paddingLeft ) +
		Number.parseFloat( styles.paddingRight ) +
		Number.parseFloat( styles.borderLeftWidth ) +
		Number.parseFloat( styles.borderRightWidth );
	if ( Number.isFinite( horizontalExtras ) ) {
		return Math.max( 0, rect.width - horizontalExtras );
	}

	const computedWidth = Number.parseFloat( styles.width );
	if ( Number.isFinite( computedWidth ) ) {
		return computedWidth;
	}
	return rect.width;
}

function captureColumnDragLayout( cells, wrapper ) {
	if ( ! wrapper || cells.length === 0 ) {
		return null;
	}
	const wrapperRect = wrapper.getBoundingClientRect();
	const headRect = cells[ 0 ].el.getBoundingClientRect();

	return {
		wrapperLeft: wrapperRect.left,
		top: headRect.top - wrapperRect.top,
		height: headRect.height,
		rects: cells.map( ( cell ) => {
			const rect = cell.el.getBoundingClientRect();
			return {
				index: cell.index,
				left: rect.left,
				right: rect.right,
				width: rect.width,
			};
		} ),
	};
}

function computeTargetIndex( layout, clientX ) {
	if ( ! layout ) {
		return null;
	}
	for ( let i = 0; i < layout.rects.length; i += 1 ) {
		const rect = layout.rects[ i ];
		if ( clientX < rect.left + rect.width / 2 ) {
			return rect.index;
		}
	}
	return layout.rects[ layout.rects.length - 1 ]?.index ?? null;
}

function computeDropIndicator( layout, targetIndex, fromIndex ) {
	if ( ! layout || targetIndex === null ) {
		return null;
	}
	const targetRect = layout.rects.find(
		( rect ) => rect.index === targetIndex
	);
	if ( ! targetRect ) {
		return null;
	}
	const targetEdge =
		targetIndex > fromIndex ? targetRect.right : targetRect.left;

	return {
		left: targetEdge - layout.wrapperLeft,
		top: layout.top,
		height: layout.height,
		targetIndex,
	};
}

function getDragClientX( event ) {
	const activator = event.activatorEvent;
	if ( typeof activator?.clientX === 'number' ) {
		return activator.clientX + event.delta.x;
	}
	const translated = event.active.rect.current.translated;
	if ( translated ) {
		return translated.left + translated.width / 2;
	}
	return null;
}

function suppressNextClick() {
	const suppressClick = ( clickEvent ) => {
		clickEvent.preventDefault();
		clickEvent.stopPropagation();
		window.removeEventListener( 'click', suppressClick, true );
	};
	window.addEventListener( 'click', suppressClick, true );
	setTimeout( () => {
		window.removeEventListener( 'click', suppressClick, true );
	}, 0 );
}

function clearColumnDragPreview( cells ) {
	for ( const cell of cells ) {
		cell.el.style.transform = '';
		cell.el.classList.remove(
			'cortext-column-reorder-preview',
			'cortext-column-drag-source'
		);
	}
}

function applyColumnDragPreview( cells, layout, fromIndex, targetIndex ) {
	if (
		! layout ||
		typeof fromIndex !== 'number' ||
		typeof targetIndex !== 'number'
	) {
		clearColumnDragPreview( cells );
		return;
	}

	const sourceRect = layout.rects.find(
		( rect ) => rect.index === fromIndex
	);
	if ( ! sourceRect ) {
		clearColumnDragPreview( cells );
		return;
	}

	const sourceWidth = sourceRect.width;
	const start = Math.min( fromIndex, targetIndex );
	const end = Math.max( fromIndex, targetIndex );
	const direction = targetIndex > fromIndex ? -1 : 1;

	for ( const cell of cells ) {
		cell.el.classList.add( 'cortext-column-reorder-preview' );
		if ( cell.index === fromIndex ) {
			cell.el.classList.add( 'cortext-column-drag-source' );
		} else {
			cell.el.classList.remove( 'cortext-column-drag-source' );
		}
		if (
			fromIndex !== targetIndex &&
			cell.index >= start &&
			cell.index <= end &&
			cell.index !== fromIndex
		) {
			cell.el.style.transform = `translateX(${
				direction * sourceWidth
			}px)`;
		} else {
			cell.el.style.transform = '';
		}
	}
}

function ColumnDragHandle( { cell } ) {
	const data = {
		fieldId: cell.fieldId,
		index: cell.index,
		label: cell.label,
	};
	const {
		attributes,
		listeners,
		setActivatorNodeRef,
		setNodeRef: setDraggableNodeRef,
	} = useDraggable( {
		id: `column:${ cell.fieldId }`,
		data,
		attributes: {
			role: 'button',
			roleDescription: __( 'draggable column', 'cortext' ),
			tabIndex: -1,
		},
	} );
	const { setNodeRef: setDroppableNodeRef } = useDroppable( {
		id: `column:${ cell.fieldId }`,
		data,
	} );

	const setHandleRef = useCallback(
		( node ) => {
			setDraggableNodeRef( node );
			setDroppableNodeRef( node );
			setActivatorNodeRef( node );
		},
		[ setActivatorNodeRef, setDraggableNodeRef, setDroppableNodeRef ]
	);

	const onClick = useCallback(
		( event ) => {
			event.preventDefault();
			event.stopPropagation();
			// Forward to the visible header button. On custom field
			// columns, Cortext hides DataViews' built-in trigger and
			// portals its own combined dropdown trigger in (same class,
			// later in DOM order); `offsetParent` rules out the hidden
			// one. tech-debt.md#td-dataviews-header-extension-slots.
			const buttons = cell.el.querySelectorAll( HEADER_BUTTON_SELECTOR );
			for ( const btn of buttons ) {
				if ( btn.offsetParent !== null ) {
					btn.click();
					return;
				}
			}
		},
		[ cell.el ]
	);

	return (
		<button
			type="button"
			ref={ setHandleRef }
			className="cortext-column-drag-handle"
			aria-label={ cell.label }
			{ ...attributes }
			{ ...listeners }
			onClick={ onClick }
		/>
	);
}

function ColumnResizer( { fieldId, fieldType, headerEl, view, onChangeView } ) {
	const cleanupRef = useRef( null );

	useEffect( () => {
		return () => {
			cleanupRef.current?.();
			cleanupRef.current = null;
		};
	}, [] );

	const autoFitColumn = useCallback( () => {
		const nextWidth = getAutoFitColumnWidth( headerEl, fieldType, fieldId );
		applyColumnWidth( headerEl, nextWidth );
		onChangeView( withColumnWidth( view, fieldId, nextWidth, fieldType ) );
	}, [ fieldId, fieldType, headerEl, onChangeView, view ] );

	const onDoubleClick = useCallback(
		( event ) => {
			event.preventDefault();
			event.stopPropagation();
			autoFitColumn();
		},
		[ autoFitColumn ]
	);

	const onPointerDown = useCallback(
		( event ) => {
			if ( event.button !== 0 ) {
				return;
			}
			event.preventDefault();
			event.stopPropagation();

			if ( event.detail >= 2 ) {
				autoFitColumn();
				return;
			}

			const startX = event.clientX;
			const startWidth = getColumnStyleWidth( headerEl );
			const handle = event.currentTarget;
			const minWidth = getMinWidth( fieldType, fieldId );
			// Pointer capture re-targets pointermove/pointerup for this
			// pointerId to the handle, even if the pointer leaves the iframe
			// or the viewport. Without it, dragging past the editor canvas
			// loses the pointer mid-resize.
			handle.setPointerCapture?.( event.pointerId );
			headerEl.classList.add( 'cortext-column-resizing' );
			document.body.classList.add( 'cortext-column-resizing' );

			// tech-debt.md#td-dataviews-column-interactions: DataViews doesn't provide a live resize hook, so
			// we mutate the rendered cells during pointer movement and commit
			// the same width into `view.layout.styles` on pointerup.
			// Find every cell in this column so the live drag mutates body
			// `<td>`s alongside the header. Keeping both header and body
			// cells in sync avoids a transient mismatch until React commits
			// the persisted width back through DataViews.
			const bodyCells = getColumnBodyCells( headerEl );

			const computeWidth = ( clientX ) => {
				const next = startWidth + ( clientX - startX );
				return Math.max(
					minWidth,
					Math.min( MAX_COLUMN_WIDTH, Math.round( next ) )
				);
			};

			const applyLiveWidth = ( width ) => {
				const px = `${ width }px`;
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
				applyLiveWidth( nextWidth );
			};

			const onPointerUp = ( upEvent ) => {
				cleanupRef.current?.();
				cleanupRef.current = null;
				const nextWidth = computeWidth( upEvent.clientX );
				if ( nextWidth === Math.round( startWidth ) ) {
					return;
				}
				onChangeView(
					withColumnWidth( view, fieldId, nextWidth, fieldType )
				);
			};

			handle.addEventListener( 'pointermove', onPointerMove );
			handle.addEventListener( 'pointerup', onPointerUp );
			handle.addEventListener( 'pointercancel', onPointerUp );
			cleanupRef.current = () => {
				handle.removeEventListener( 'pointermove', onPointerMove );
				handle.removeEventListener( 'pointerup', onPointerUp );
				handle.removeEventListener( 'pointercancel', onPointerUp );
				if ( handle.hasPointerCapture?.( event.pointerId ) ) {
					handle.releasePointerCapture?.( event.pointerId );
				}
				headerEl.classList.remove( 'cortext-column-resizing' );
				document.body.classList.remove( 'cortext-column-resizing' );
			};
		},
		[ autoFitColumn, fieldId, fieldType, headerEl, onChangeView, view ]
	);

	return (
		<div
			className="cortext-column-resizer"
			role="separator"
			aria-orientation="vertical"
			aria-label={ __( 'Resize column', 'cortext' ) }
			onDoubleClick={ onDoubleClick }
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
	const [ activeColumn, setActiveColumn ] = useState( null );
	const sensors = useSensors(
		useSensor( PointerSensor, {
			activationConstraint: { distance: DRAG_ACTIVATION_DISTANCE },
		} )
	);

	const viewRef = useRef( view );
	viewRef.current = view;
	const onChangeViewRef = useRef( onChangeView );
	onChangeViewRef.current = onChangeView;
	const cellsRef = useRef( cells );
	cellsRef.current = cells;
	const dropTargetRef = useRef( dropTarget );
	dropTargetRef.current = dropTarget;
	const dragLayoutRef = useRef( null );

	const updateDropTarget = useCallback( ( event ) => {
		const clientX = getDragClientX( event );
		if ( clientX === null ) {
			setDropTarget( null );
			return null;
		}

		const layout = dragLayoutRef.current;
		const nextTargetIndex = computeTargetIndex( layout, clientX );
		const indicator = computeDropIndicator(
			layout,
			nextTargetIndex,
			event.active.data.current?.index
		);
		applyColumnDragPreview(
			cellsRef.current,
			layout,
			event.active.data.current?.index,
			nextTargetIndex
		);
		setDropTarget( indicator );
		return indicator;
	}, [] );

	const onDragStart = useCallback(
		( event ) => {
			clearColumnDragPreview( cellsRef.current );
			dragLayoutRef.current = captureColumnDragLayout(
				cellsRef.current,
				wrapperRef.current
			);
			document.body.classList.add( 'cortext-column-dragging' );
			setActiveColumn( event.active.data.current ?? null );
		},
		[ wrapperRef ]
	);

	const onDragMove = useCallback(
		( event ) => {
			updateDropTarget( event );
		},
		[ updateDropTarget ]
	);

	const onDragEnd = useCallback(
		( event ) => {
			const finalDropTarget =
				updateDropTarget( event ) ?? dropTargetRef.current;
			const fromIndex = event.active.data.current?.index;

			document.body.classList.remove( 'cortext-column-dragging' );
			clearColumnDragPreview( cellsRef.current );
			dragLayoutRef.current = null;
			setDropTarget( null );
			setActiveColumn( null );
			suppressNextClick();

			if (
				typeof fromIndex !== 'number' ||
				! finalDropTarget ||
				finalDropTarget.targetIndex === fromIndex
			) {
				return;
			}

			onChangeViewRef.current(
				withColumnOrder(
					viewRef.current,
					fromIndex,
					finalDropTarget.targetIndex
				)
			);
		},
		[ updateDropTarget ]
	);

	const onDragCancel = useCallback( () => {
		document.body.classList.remove( 'cortext-column-dragging' );
		clearColumnDragPreview( cellsRef.current );
		dragLayoutRef.current = null;
		setDropTarget( null );
		setActiveColumn( null );
	}, [] );

	useEffect( () => {
		return () => {
			document.body.classList.remove( 'cortext-column-dragging' );
			document.body.classList.remove( 'cortext-column-resizing' );
			clearColumnDragPreview( cellsRef.current );
			dragLayoutRef.current = null;
		};
	}, [] );

	if ( cells.length === 0 ) {
		return null;
	}

	return (
		<DndContext
			sensors={ sensors }
			collisionDetection={ pointerWithin }
			onDragStart={ onDragStart }
			onDragMove={ onDragMove }
			onDragEnd={ onDragEnd }
			onDragCancel={ onDragCancel }
			autoScroll={ false }
		>
			{ cells.map( ( cell ) =>
				createPortal(
					<>
						<ColumnDragHandle cell={ cell } />
						<ColumnResizer
							fieldId={ cell.fieldId }
							fieldType={ cell.fieldType }
							headerEl={ cell.el }
							view={ view }
							onChangeView={ onChangeView }
						/>
					</>,
					cell.el,
					cell.fieldId
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
			<DragOverlay dropAnimation={ null }>
				{ activeColumn ? (
					<div className="cortext-column-drag-preview">
						{ activeColumn.label }
					</div>
				) : null }
			</DragOverlay>
		</DndContext>
	);
}
