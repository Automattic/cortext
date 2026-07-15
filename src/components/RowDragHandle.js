import {
	createPortal,
	useCallback,
	useLayoutEffect,
	useMemo,
} from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import { useDraggable } from '@dnd-kit/core';

import { INTERACTIVE_DATA_VIEW_ITEM_IGNORE_SELECTOR } from './dataViewItemLookup';

const ROW_DRAGGING_CLASS = 'cortext-row-dragging';
const ROW_SUPPRESS_HOVER_CLASS = 'cortext-row-reorder-suppress-hover';
const HOVER_SUPPRESSION_PRIME_TIMEOUT = 800;
const KEYBOARD_DRAG_CODES = new Set( [
	'ArrowDown',
	'ArrowLeft',
	'ArrowRight',
	'ArrowUp',
	'Enter',
	'Escape',
	'Space',
	'Tab',
] );

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

function applyActivatorAttributes( node, attributes ) {
	const appliedAttributes = [];

	for ( const [ name, value ] of Object.entries( attributes ?? {} ) ) {
		// DataViews owns role and tabIndex for composite navigation. Forward
		// dnd-kit's remaining ARIA state and screen-reader instructions.
		if ( name === 'role' || name === 'tabIndex' || value === undefined ) {
			continue;
		}

		const previousValue = node.getAttribute( name );
		const nextValue = String( value );
		node.setAttribute( name, nextValue );
		appliedAttributes.push( { name, nextValue, previousValue } );
	}

	return () => {
		for ( const { name, nextValue, previousValue } of appliedAttributes ) {
			// Leave attributes alone if DataViews changed them after we applied
			// ours.
			if ( node.getAttribute( name ) !== nextValue ) {
				continue;
			}
			if ( previousValue === null ) {
				node.removeAttribute( name );
			} else {
				node.setAttribute( name, previousValue );
			}
		}
	};
}

function nativeKeyboardEventForDnd( event, currentTarget ) {
	return {
		nativeEvent: event,
		target: event.target,
		currentTarget,
		preventDefault: () => event.preventDefault(),
		stopPropagation: () => event.stopPropagation(),
	};
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
			role: activateFromRow
				? row.el?.getAttribute( 'role' ) || 'group'
				: 'button',
			roleDescription: __( 'draggable item', 'cortext' ),
			tabIndex: activateFromRow ? row.el?.tabIndex ?? 0 : 0,
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
		if ( ! activateFromRow || ! row.el ) {
			return undefined;
		}

		const activator = row.el;
		setActivatorNodeRef( activator );
		const restoreAttributes = applyActivatorAttributes(
			activator,
			attributes
		);
		const onKeyDown = ( event ) => {
			if ( isDragging && KEYBOARD_DRAG_CODES.has( event.code ) ) {
				// Block DataViews from moving focus or opening the card, but let the
				// event reach KeyboardSensor on the owner document.
				event.preventDefault();
				return;
			}
			if ( event.defaultPrevented || ! listeners?.onKeyDown ) {
				return;
			}

			listeners.onKeyDown(
				nativeKeyboardEventForDnd( event, activator )
			);
			// KeyboardSensor prevents the event only when it starts a drag. Stop that
			// event before DataViews opens the card; otherwise, leave arrow navigation
			// untouched.
			if ( event.defaultPrevented ) {
				primeRowHoverSuppression( activator.ownerDocument );
				event.stopPropagation();
			}
		};

		activator.addEventListener( 'keydown', onKeyDown );
		return () => {
			activator.removeEventListener( 'keydown', onKeyDown );
			restoreAttributes();
			setActivatorNodeRef( null );
		};
	}, [
		activateFromRow,
		attributes,
		isDragging,
		listeners,
		row.el,
		setActivatorNodeRef,
	] );

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
			if (
				event.target?.closest?.(
					INTERACTIVE_DATA_VIEW_ITEM_IGNORE_SELECTOR
				)
			) {
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
