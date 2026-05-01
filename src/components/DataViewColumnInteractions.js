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

import {
	MAX_COLUMN_WIDTH,
	TITLE_FIELD_ID,
	clampWidth,
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
			return {
				fieldId,
				fieldType: fieldTypeFor( fieldId, fieldsById ),
				index,
				label: el.textContent?.trim() || fieldId,
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

function measureCellNaturalWidth( cell ) {
	const table = document.createElement( 'table' );
	const row = document.createElement( 'tr' );
	const clone = cell.cloneNode( true );

	clone.querySelector( '.cortext-column-resizer' )?.remove();
	clone.removeAttribute( 'style' );
	clone.style.width = 'auto';
	clone.style.minWidth = '0';
	clone.style.maxWidth = 'none';

	table.className = cell.closest( TABLE_SELECTOR )?.className ?? '';
	table.style.position = 'fixed';
	table.style.left = '-10000px';
	table.style.top = '0';
	table.style.width = 'auto';
	table.style.tableLayout = 'auto';
	table.style.visibility = 'hidden';
	table.style.pointerEvents = 'none';

	row.appendChild( clone );
	table.appendChild( row );
	document.body.appendChild( table );
	const width = clone.getBoundingClientRect().width;
	table.remove();

	return width;
}

function getAutoFitColumnWidth( headerEl, fieldType ) {
	const cells = [ headerEl, ...getColumnBodyCells( headerEl ) ];
	const naturalWidth = Math.max(
		...cells.map( ( cell ) => measureCellNaturalWidth( cell ) )
	);
	return clampWidth( naturalWidth, fieldType );
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

function computeTargetIndex( cells, clientX ) {
	for ( let i = 0; i < cells.length; i += 1 ) {
		const rect = cells[ i ].el.getBoundingClientRect();
		if ( clientX < rect.left + rect.width / 2 ) {
			return i;
		}
	}
	return cells.length - 1;
}

function computeDropIndicator( cells, wrapper, targetIndex, fromIndex ) {
	if ( ! wrapper || cells.length === 0 || targetIndex === null ) {
		return null;
	}
	const wrapperRect = wrapper.getBoundingClientRect();
	const headRect = cells[ 0 ].el.getBoundingClientRect();
	const targetCell = cells[ targetIndex ];
	const targetRect = targetCell.el.getBoundingClientRect();
	const targetEdge =
		targetIndex > fromIndex ? targetRect.right : targetRect.left;

	return {
		left: targetEdge - wrapperRect.left,
		top: headRect.top - wrapperRect.top,
		height: headRect.height,
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

function getColumnVisualCells( cell ) {
	return [ cell.el, ...getColumnBodyCells( cell.el ) ];
}

function clearColumnDragPreview( cells ) {
	for ( const cell of cells ) {
		for ( const el of getColumnVisualCells( cell ) ) {
			el.style.transform = '';
			el.classList.remove(
				'cortext-column-reorder-preview',
				'cortext-column-drag-source'
			);
		}
	}
}

function applyColumnDragPreview( cells, fromIndex, targetIndex ) {
	clearColumnDragPreview( cells );
	if (
		typeof fromIndex !== 'number' ||
		typeof targetIndex !== 'number' ||
		fromIndex === targetIndex
	) {
		return;
	}

	const sourceCell = cells[ fromIndex ];
	if ( ! sourceCell ) {
		return;
	}

	const sourceWidth = sourceCell.el.getBoundingClientRect().width;
	const start = Math.min( fromIndex, targetIndex );
	const end = Math.max( fromIndex, targetIndex );
	const direction = targetIndex > fromIndex ? -1 : 1;

	for ( const cell of cells ) {
		for ( const el of getColumnVisualCells( cell ) ) {
			el.classList.add( 'cortext-column-reorder-preview' );
			if ( cell.index === fromIndex ) {
				el.classList.add( 'cortext-column-drag-source' );
			}
			if ( cell.index >= start && cell.index <= end ) {
				if ( cell.index !== fromIndex ) {
					el.style.transform = `translateX(${
						direction * sourceWidth
					}px)`;
				}
			}
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
			cell.el.querySelector( HEADER_BUTTON_SELECTOR )?.click();
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
	const autoFitColumn = useCallback( () => {
		const nextWidth = getAutoFitColumnWidth( headerEl, fieldType );
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
			const minWidth = getMinWidth( fieldType );
			// Pointer capture re-targets pointermove/pointerup for this
			// pointerId to the handle, even if the pointer leaves the iframe
			// or the viewport. Without it, dragging past the editor canvas
			// loses the pointer mid-resize.
			handle.setPointerCapture?.( event.pointerId );
			headerEl.classList.add( 'cortext-column-resizing' );
			document.body.classList.add( 'cortext-column-resizing' );

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
				handle.removeEventListener( 'pointermove', onPointerMove );
				handle.removeEventListener( 'pointerup', onPointerUp );
				handle.removeEventListener( 'pointercancel', onPointerUp );
				handle.releasePointerCapture?.( upEvent.pointerId );
				headerEl.classList.remove( 'cortext-column-resizing' );
				document.body.classList.remove( 'cortext-column-resizing' );
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

	const updateDropTarget = useCallback(
		( event ) => {
			const clientX = getDragClientX( event );
			if ( clientX === null ) {
				setDropTarget( null );
				return null;
			}

			const nextTargetIndex = computeTargetIndex(
				cellsRef.current,
				clientX
			);
			const indicator = computeDropIndicator(
				cellsRef.current,
				wrapperRef.current,
				nextTargetIndex,
				event.active.data.current?.index
			);
			applyColumnDragPreview(
				cellsRef.current,
				event.active.data.current?.index,
				nextTargetIndex
			);
			setDropTarget( indicator );
			return indicator;
		},
		[ wrapperRef ]
	);

	const onDragStart = useCallback( ( event ) => {
		document.body.classList.add( 'cortext-column-dragging' );
		setActiveColumn( event.active.data.current ?? null );
	}, [] );

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
		setDropTarget( null );
		setActiveColumn( null );
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
