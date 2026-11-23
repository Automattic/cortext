import { useFocusOnMount, useMergeRefs } from '@wordpress/compose';
import {
	useCallback,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';
import { __ } from '@wordpress/i18n';

const WIDTH_KEY = 'cortext.rowDetailSidebarWidth';
const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
const MAX_WIDTH = 840;
const RESIZE_STEP = 24;
const MAX_VIEWPORT_RATIO = 0.66;
const TABBABLE =
	'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])';
const SENTINEL_CLASS = 'cortext-row-detail-sidebar-shell__focus-sentinel';

// The element focused in a document. An editor iframe reports itself as
// active, so look inside it for the real control.
function focusedElementIn( ownerDocument ) {
	const active = ownerDocument.activeElement;
	if ( active?.tagName === 'IFRAME' ) {
		try {
			return active.contentDocument?.activeElement ?? active;
		} catch {
			return active;
		}
	}
	return active;
}

function tabbablesIn( element ) {
	return [ ...element.querySelectorAll( TABBABLE ) ].filter(
		( node ) =>
			! node.classList.contains( SENTINEL_CLASS ) &&
			node.getClientRects().length > 0
	);
}

function getMaxWidth() {
	if ( typeof window === 'undefined' ) {
		return MAX_WIDTH;
	}
	const viewportMax = Math.floor( window.innerWidth * MAX_VIEWPORT_RATIO );
	return Math.max( MIN_WIDTH, Math.min( MAX_WIDTH, viewportMax ) );
}

function clampWidth( value ) {
	const numericValue = Number.isFinite( value ) ? value : DEFAULT_WIDTH;
	return Math.min(
		getMaxWidth(),
		Math.max( MIN_WIDTH, Math.round( numericValue ) )
	);
}

function initialWidth() {
	if ( typeof window === 'undefined' ) {
		return DEFAULT_WIDTH;
	}
	let stored = NaN;
	try {
		stored = Number.parseInt(
			window.localStorage?.getItem( WIDTH_KEY ),
			10
		);
	} catch {
		// Ignore storage access failures and fall back to the default width.
	}
	return clampWidth( Number.isFinite( stored ) ? stored : DEFAULT_WIDTH );
}

// The side peek's width, saved across sessions, and its drag handle.
function useSideWidth() {
	const [ width, setWidth ] = useState( initialWidth );
	const dragRef = useRef( null );
	const widthRef = useRef( width );

	const commitWidth = useCallback( ( next ) => {
		const clamped = clampWidth( next );
		widthRef.current = clamped;
		setWidth( clamped );
		if ( typeof window !== 'undefined' ) {
			try {
				window.localStorage?.setItem( WIDTH_KEY, String( clamped ) );
			} catch {
				// Saving the preference is best-effort; resizing should still work.
			}
		}
	}, [] );

	useEffect( () => {
		widthRef.current = width;
	}, [ width ] );

	useEffect( () => {
		return () => {
			document.body.classList.remove(
				'cortext-row-detail-sidebar-resizing'
			);
		};
	}, [] );

	useEffect( () => {
		const onWindowResize = () => {
			commitWidth( widthRef.current );
		};
		window.addEventListener( 'resize', onWindowResize );
		return () => {
			window.removeEventListener( 'resize', onWindowResize );
		};
	}, [ commitWidth ] );

	const onPointerDown = useCallback( ( event ) => {
		if ( event.button !== 0 ) {
			return;
		}
		event.preventDefault();
		event.currentTarget.setPointerCapture?.( event.pointerId );
		document.body.classList.add( 'cortext-row-detail-sidebar-resizing' );
		dragRef.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			startWidth: widthRef.current,
		};
	}, [] );

	const onPointerMove = useCallback( ( event ) => {
		const drag = dragRef.current;
		if ( ! drag || drag.pointerId !== event.pointerId ) {
			return;
		}
		const next = clampWidth(
			drag.startWidth + drag.startX - event.clientX
		);
		widthRef.current = next;
		setWidth( next );
	}, [] );

	const onPointerEnd = useCallback(
		( event ) => {
			const drag = dragRef.current;
			if ( ! drag || drag.pointerId !== event.pointerId ) {
				return;
			}
			if ( event.currentTarget.hasPointerCapture?.( event.pointerId ) ) {
				event.currentTarget.releasePointerCapture?.( event.pointerId );
			}
			document.body.classList.remove(
				'cortext-row-detail-sidebar-resizing'
			);
			dragRef.current = null;
			commitWidth( widthRef.current );
		},
		[ commitWidth ]
	);

	const onKeyDown = useCallback(
		( event ) => {
			if ( event.key === 'ArrowLeft' ) {
				event.preventDefault();
				commitWidth( width + RESIZE_STEP );
			} else if ( event.key === 'ArrowRight' ) {
				event.preventDefault();
				commitWidth( width - RESIZE_STEP );
			} else if ( event.key === 'Home' ) {
				event.preventDefault();
				commitWidth( MIN_WIDTH );
			} else if ( event.key === 'End' ) {
				event.preventDefault();
				commitWidth( MAX_WIDTH );
			}
		},
		[ commitWidth, width ]
	);

	return {
		width,
		handleProps: {
			onPointerDown,
			onPointerMove,
			onPointerUp: onPointerEnd,
			onPointerCancel: onPointerEnd,
			onKeyDown,
		},
	};
}

// One open document, shown as a side peek or a center peek. Switching modes
// only changes this window's box, so its content stays mounted and reflows
// while the box animates. A center peek behaves as a modal dialog: it takes
// focus, keeps Tab inside, and closes on Escape.
export default function PeekWindow( {
	mode,
	openedAsCenter,
	isClosing,
	onRequestClose,
	onExited,
	children,
} ) {
	const isCenter = mode === 'modal';
	const { width, handleProps } = useSideWidth();
	const windowRef = useRef( null );
	// Give focus back to whatever opened the peek. Read the opener as the
	// window attaches, before a center peek moves focus onto itself.
	const openerRef = useRef( null );
	const captureOpenerRef = useCallback( ( node ) => {
		if ( node && ! openerRef.current ) {
			openerRef.current = focusedElementIn( node.ownerDocument );
		}
	}, [] );
	// A center peek takes focus on the window itself, like a modal frame. Its
	// first control can be a loading placeholder that unmounts a moment later.
	const focusOnMountRef = useFocusOnMount( openedAsCenter );
	const ref = useMergeRefs( [
		windowRef,
		captureOpenerRef,
		focusOnMountRef,
	] );
	// Closing first removes the content, which drops focus to the page, so
	// return it as soon as the window starts closing instead of when it
	// unmounts.
	useLayoutEffect( () => {
		const opener = openerRef.current;
		if ( ! isClosing || ! opener?.isConnected ) {
			return;
		}
		const ownerDocument = windowRef.current.ownerDocument;
		const active = ownerDocument.activeElement;
		if (
			! active ||
			active === ownerDocument.body ||
			windowRef.current.contains( active )
		) {
			opener.focus();
		}
	}, [ isClosing ] );

	// The mode button that was clicked disappears in the new mode. Keep focus
	// in the window instead of letting it fall back to the page.
	const previousModeRef = useRef( mode );
	useEffect( () => {
		if ( previousModeRef.current === mode ) {
			return;
		}
		previousModeRef.current = mode;
		const element = windowRef.current;
		if (
			element &&
			! element.contains( element.ownerDocument.activeElement )
		) {
			element.focus( { preventScroll: true } );
		}
	}, [ mode ] );

	// The content arrives through a portal, so React events from it bubble up
	// the Fill's tree, not this one. Listen on the DOM instead.
	const onRequestCloseRef = useRef( onRequestClose );
	onRequestCloseRef.current = onRequestClose;
	useEffect( () => {
		const element = windowRef.current;
		if ( ! isCenter || ! element ) {
			return undefined;
		}
		const onKeyDown = ( event ) => {
			// Escape that ends an IME composition belongs to the text field.
			if ( event.isComposing || event.keyCode === 229 ) {
				return;
			}
			if ( event.key === 'Escape' && ! event.defaultPrevented ) {
				event.preventDefault();
				onRequestCloseRef.current();
				return;
			}
			// The window itself sits before the first sentinel, so Shift+Tab
			// from it would leave the peek. Wrap to the last control instead.
			if (
				event.key === 'Tab' &&
				event.shiftKey &&
				event.target === element
			) {
				event.preventDefault();
				const tabbables = tabbablesIn( element );
				tabbables[ tabbables.length - 1 ]?.focus();
			}
		};
		element.addEventListener( 'keydown', onKeyDown );
		return () => element.removeEventListener( 'keydown', onKeyDown );
	}, [ isCenter ] );

	// Keep Tab inside a center peek. Focus that leaves the content lands on a
	// sentinel at either edge, which sends it to the other end. Unlike a
	// keydown trap, this also catches Tab pressed inside the editor iframe.
	const wrapFocus = ( toEnd ) => {
		const tabbables = tabbablesIn( windowRef.current );
		const target = toEnd
			? tabbables[ tabbables.length - 1 ]
			: tabbables[ 0 ];
		target?.focus();
	};
	const showSentinels = isCenter && ! isClosing;

	const onAnimationEnd = ( event ) => {
		if ( isClosing && event.target === event.currentTarget ) {
			onExited();
		}
	};

	return (
		<div
			ref={ ref }
			className={
				'cortext-row-detail-sidebar-shell' +
				( isCenter
					? ' cortext-row-detail-sidebar-shell--center'
					: '' ) +
				( openedAsCenter
					? ' cortext-row-detail-sidebar-shell--opened-center'
					: '' ) +
				( isClosing
					? ' cortext-row-detail-sidebar-shell--closing'
					: '' )
			}
			tabIndex={ -1 }
			aria-hidden={ isClosing ? true : undefined }
			{ ...( isClosing ? { inert: '' } : {} ) }
			style={ {
				'--cortext-row-detail-sidebar-width': `${ width }px`,
			} }
			onAnimationEnd={ onAnimationEnd }
		>
			{ showSentinels ? (
				<span
					className={ SENTINEL_CLASS }
					tabIndex={ 0 }
					onFocus={ ( event ) =>
						// Shift+Tab from the first control wraps to the end. Tab
						// from the window itself starts at the beginning.
						wrapFocus(
							event.relatedTarget !== windowRef.current &&
								windowRef.current.contains(
									event.relatedTarget
								)
						)
					}
				/>
			) : null }
			{ ! isClosing && ! isCenter ? (
				<div
					className="cortext-row-detail-sidebar-shell__resize-handle"
					role="separator"
					aria-label={ __( 'Resize side peek', 'cortext' ) }
					aria-orientation="vertical"
					aria-valuemin={ MIN_WIDTH }
					aria-valuemax={ getMaxWidth() }
					aria-valuenow={ width }
					tabIndex={ 0 }
					{ ...handleProps }
				/>
			) : null }
			{ isClosing ? null : children }
			{ showSentinels ? (
				<span
					className={ SENTINEL_CLASS }
					tabIndex={ 0 }
					onFocus={ () => wrapFocus( false ) }
				/>
			) : null }
		</div>
	);
}
