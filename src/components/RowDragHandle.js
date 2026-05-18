import {
	createPortal,
	useCallback,
	useLayoutEffect,
	useMemo,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { useDraggable } from '@dnd-kit/core';

const ROW_DRAGGING_CLASS = 'cortext-row-dragging';
const ROW_SUPPRESS_HOVER_CLASS = 'cortext-row-reorder-suppress-hover';
const HOVER_SUPPRESSION_PRIME_TIMEOUT = 800;

function primeRowHoverSuppression() {
	document.body.classList.add( ROW_SUPPRESS_HOVER_CLASS );
	window.setTimeout( () => {
		if ( ! document.body.classList.contains( ROW_DRAGGING_CLASS ) ) {
			document.body.classList.remove( ROW_SUPPRESS_HOVER_CLASS );
		}
	}, HOVER_SUPPRESSION_PRIME_TIMEOUT );
}

export default function RowDragHandle( { row } ) {
	const {
		attributes,
		listeners,
		setActivatorNodeRef,
		setNodeRef: setDraggableNodeRef,
		isDragging,
	} = useDraggable( {
		id: `row:${ row.rowId }`,
		data: row,
		attributes: {
			role: 'button',
			roleDescription: __( 'draggable row', 'cortext' ),
		},
	} );

	// dnd-kit's draggable has two roles: the node it measures for collision
	// detection (and anchors the overlay to), and the activator whose
	// pointerdown kicks off the drag. The `<tr>` is the node; the small
	// handle button is the activator. If both pointed at the button,
	// dnd-kit would size the drag around 24px and the preview would float
	// off to one side of the row.
	useLayoutEffect( () => {
		if ( ! row.el ) {
			return undefined;
		}
		setDraggableNodeRef( row.el );
		return () => setDraggableNodeRef( null );
	}, [ row.el, setDraggableNodeRef ] );

	const setHandleRef = useCallback(
		( node ) => {
			setActivatorNodeRef( node );
		},
		[ setActivatorNodeRef ]
	);

	const stopClick = useCallback( ( event ) => {
		event.preventDefault();
		event.stopPropagation();
	}, [] );

	const stopPropagation = useCallback( ( event ) => {
		event.stopPropagation();
	}, [] );

	const stopInteractionStart = useCallback( ( event ) => {
		primeRowHoverSuppression();
		event.stopPropagation();
	}, [] );

	const guardedListeners = useMemo(
		() =>
			Object.fromEntries(
				Object.entries( listeners ?? {} ).map(
					( [ eventName, handler ] ) => [
						eventName,
						( event ) => {
							if (
								eventName === 'onPointerDown' ||
								eventName === 'onMouseDown' ||
								eventName === 'onTouchStart' ||
								eventName === 'onKeyDown'
							) {
								primeRowHoverSuppression();
							}
							event.stopPropagation();
							handler?.( event );
						},
					]
				)
			),
		[ listeners ]
	);

	if ( ! row.handleEl ) {
		return null;
	}

	return createPortal(
		<button
			type="button"
			ref={ setHandleRef }
			className="cortext-row-drag-handle"
			aria-label={ sprintf(
				/* translators: %s: row title */
				__( 'Reorder row: %s', 'cortext' ),
				row.label
			) }
			data-dragging={ isDragging ? 'true' : 'false' }
			onClick={ stopClick }
			onFocus={ stopPropagation }
			onMouseDown={ stopInteractionStart }
			onTouchStart={ stopInteractionStart }
			{ ...attributes }
			{ ...guardedListeners }
		/>,
		row.handleEl
	);
}
