import { __ } from '@wordpress/i18n';
import { useCallback, useRef, useState } from '@wordpress/element';

import {
	clampWidth,
	SIDEBAR_RESIZE_STEP,
	SIDEBAR_WIDTH_MIN,
	SIDEBAR_WIDTH_MAX,
} from '../hooks/useSidebarLayout';

// Pointer drag writes the CSS var on the root every move (no React
// re-render per frame) and commits to state on pointerup. Pointer cancel
// reverts to the starting width. Keyboard parity: the handle is focusable,
// with arrows/Home/End to resize and Enter to toggle collapse.
export default function SidebarResizeHandle( {
	width,
	onChange,
	onToggleCollapsed,
} ) {
	const [ isResizing, setIsResizing ] = useState( false );
	const startXRef = useRef( 0 );
	const startWidthRef = useRef( width );
	const liveWidthRef = useRef( width );

	const writeRoot = useCallback( ( next ) => {
		const root = document.getElementById( 'cortext-root' );
		if ( root ) {
			root.style.setProperty( '--cortext-sidebar-width', `${ next }px` );
		}
	}, [] );

	const onPointerDown = useCallback(
		( event ) => {
			if ( event.button !== 0 ) {
				return;
			}
			event.preventDefault();
			event.currentTarget.setPointerCapture( event.pointerId );
			startXRef.current = event.clientX;
			startWidthRef.current = width;
			liveWidthRef.current = width;
			setIsResizing( true );
			document.body.classList.add( 'cortext-sidebar-resizing' );
			const root = document.getElementById( 'cortext-root' );
			if ( root ) {
				root.setAttribute( 'data-sidebar-resizing', 'true' );
			}
		},
		[ width ]
	);

	const onPointerMove = useCallback(
		( event ) => {
			if ( ! event.currentTarget.hasPointerCapture( event.pointerId ) ) {
				return;
			}
			const next = clampWidth(
				startWidthRef.current + ( event.clientX - startXRef.current )
			);
			liveWidthRef.current = next;
			writeRoot( next );
		},
		[ writeRoot ]
	);

	const cleanupResize = useCallback( ( event ) => {
		if ( event.currentTarget.hasPointerCapture( event.pointerId ) ) {
			event.currentTarget.releasePointerCapture( event.pointerId );
		}
		setIsResizing( false );
		document.body.classList.remove( 'cortext-sidebar-resizing' );
		const root = document.getElementById( 'cortext-root' );
		if ( root ) {
			root.removeAttribute( 'data-sidebar-resizing' );
		}
	}, [] );

	const commitResize = useCallback(
		( event ) => {
			cleanupResize( event );
			onChange( liveWidthRef.current );
		},
		[ cleanupResize, onChange ]
	);

	const cancelResize = useCallback(
		( event ) => {
			cleanupResize( event );
			liveWidthRef.current = startWidthRef.current;
			writeRoot( startWidthRef.current );
		},
		[ cleanupResize, writeRoot ]
	);

	const onKeyDown = useCallback(
		( event ) => {
			let next = null;
			switch ( event.key ) {
				case 'ArrowLeft':
					next = clampWidth( width - SIDEBAR_RESIZE_STEP );
					break;
				case 'ArrowRight':
					next = clampWidth( width + SIDEBAR_RESIZE_STEP );
					break;
				case 'Home':
					next = SIDEBAR_WIDTH_MIN;
					break;
				case 'End':
					next = SIDEBAR_WIDTH_MAX;
					break;
				case 'Enter':
				case ' ':
					event.preventDefault();
					onToggleCollapsed();
					return;
				default:
					return;
			}
			event.preventDefault();
			writeRoot( next );
			onChange( next );
		},
		[ width, onChange, onToggleCollapsed, writeRoot ]
	);

	return (
		// eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions
		<div
			className={
				'cortext-sidebar__resize-handle' +
				( isResizing ? ' is-resizing' : '' )
			}
			role="separator"
			tabIndex={ 0 }
			aria-orientation="vertical"
			aria-controls="cortext-sidebar"
			aria-label={ __( 'Resize sidebar', 'cortext' ) }
			aria-valuenow={ width }
			aria-valuemin={ SIDEBAR_WIDTH_MIN }
			aria-valuemax={ SIDEBAR_WIDTH_MAX }
			onPointerDown={ onPointerDown }
			onPointerMove={ onPointerMove }
			onPointerUp={ commitResize }
			onPointerCancel={ cancelResize }
			onKeyDown={ onKeyDown }
		/>
	);
}
