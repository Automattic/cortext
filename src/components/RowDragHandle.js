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
const NATIVE_ACTIVATOR_IGNORE_SELECTOR =
	'button, a, input, textarea, select, [contenteditable="true"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"], .components-button, .cortext-editable-cell, .cortext-row-drag-handle';

function primeRowHoverSuppression( ownerDocument = document ) {
	const body = ownerDocument?.body ?? document.body;
	const ownerWindow = ownerDocument?.defaultView ?? window;
	body.classList.add( ROW_SUPPRESS_HOVER_CLASS );
	ownerWindow.setTimeout( () => {
		if ( ! body.classList.contains( ROW_DRAGGING_CLASS ) ) {
			body.classList.remove( ROW_SUPPRESS_HOVER_CLASS );
		}
	}, HOVER_SUPPRESSION_PRIME_TIMEOUT );
}

function capturePointer( event ) {
	const pointerId = event.pointerId ?? event.nativeEvent?.pointerId;
	if ( pointerId === undefined ) {
		return;
	}
	event.currentTarget?.setPointerCapture?.( pointerId );
}

export default function RowDragHandle( {
	row,
	keyboardFocusable = true,
	activateFromRow = false,
	renderHandle = true,
} ) {
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
			roleDescription: __( 'draggable item', 'cortext' ),
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
		primeRowHoverSuppression( event.currentTarget?.ownerDocument );
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
								primeRowHoverSuppression(
									event.currentTarget?.ownerDocument
								);
							}
							if ( eventName === 'onPointerDown' ) {
								capturePointer( event );
							}
							event.stopPropagation();
							handler?.( event );
						},
					]
				)
			),
		[ listeners ]
	);

	useLayoutEffect( () => {
		if ( ! activateFromRow || ! row.el || ! listeners?.onPointerDown ) {
			return undefined;
		}

		const onPointerDown = ( event ) => {
			if (
				event.defaultPrevented ||
				event.button !== 0 ||
				! event.isPrimary
			) {
				return;
			}
			if ( event.target?.closest?.( NATIVE_ACTIVATOR_IGNORE_SELECTOR ) ) {
				return;
			}

			primeRowHoverSuppression( row.el.ownerDocument );
			listeners.onPointerDown( { nativeEvent: event } );
		};

		row.el.addEventListener( 'pointerdown', onPointerDown );
		return () => {
			row.el?.removeEventListener( 'pointerdown', onPointerDown );
		};
	}, [ activateFromRow, listeners, row.el ] );

	if ( ! renderHandle || ! row.handleEl ) {
		return null;
	}

	return createPortal(
		<span
			ref={ setHandleRef }
			className="cortext-row-drag-handle"
			aria-label={ sprintf(
				/* translators: %s: item title */
				__( 'Reorder: %s', 'cortext' ),
				row.label
			) }
			data-dragging={ isDragging ? 'true' : 'false' }
			onClick={ stopClick }
			onFocus={ stopPropagation }
			onKeyDown={ stopPropagation }
			onMouseDown={ stopInteractionStart }
			onTouchStart={ stopInteractionStart }
			{ ...attributes }
			role="button"
			tabIndex={ keyboardFocusable ? 0 : -1 }
			{ ...guardedListeners }
		/>,
		row.handleEl
	);
}
