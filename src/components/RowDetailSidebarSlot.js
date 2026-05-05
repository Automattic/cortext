import {
	createSlotFill,
	// eslint-disable-next-line @wordpress/no-unsafe-wp-apis
	__experimentalUseSlotFills as useSlotFills,
} from '@wordpress/components';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

export const RowDetailSidebar = createSlotFill( 'CortextRowDetailSidebar' );

const WIDTH_KEY = 'cortext.rowDetailSidebarWidth';
const DEFAULT_WIDTH = 560;
const MIN_WIDTH = 360;
const MAX_WIDTH = 840;
const RESIZE_STEP = 24;
const MAX_VIEWPORT_RATIO = 0.66;

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

export function RowDetailSidebarSlot( { fallback = null } ) {
	const fills = useSlotFills( RowDetailSidebar.name );
	const hasRowDetail = Boolean( fills?.length );
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
			if ( typeof document !== 'undefined' ) {
				document.body.classList.remove(
					'cortext-row-detail-sidebar-resizing'
				);
			}
		};
	}, [] );

	useEffect( () => {
		if ( typeof window === 'undefined' ) {
			return undefined;
		}

		const onWindowResize = () => {
			commitWidth( widthRef.current );
		};

		window.addEventListener( 'resize', onWindowResize );
		return () => {
			window.removeEventListener( 'resize', onWindowResize );
		};
	}, [ commitWidth ] );

	const onResizeStart = useCallback( ( event ) => {
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

	const onResizeMove = useCallback( ( event ) => {
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

	const onResizeEnd = useCallback(
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

	const onResizeKeyDown = useCallback(
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

	if ( ! hasRowDetail ) {
		return fallback;
	}

	const maxWidth = getMaxWidth();

	return (
		<div
			className="cortext-row-detail-sidebar-shell"
			style={ {
				'--cortext-row-detail-sidebar-width': `${ width }px`,
			} }
		>
			{ /* eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions */ }
			<div
				className="cortext-row-detail-sidebar-shell__resize-handle"
				role="separator"
				aria-label={ __( 'Resize row detail panel', 'cortext' ) }
				aria-orientation="vertical"
				aria-valuemin={ MIN_WIDTH }
				aria-valuemax={ maxWidth }
				aria-valuenow={ width }
				tabIndex={ 0 }
				onPointerDown={ onResizeStart }
				onPointerMove={ onResizeMove }
				onPointerUp={ onResizeEnd }
				onPointerCancel={ onResizeEnd }
				onKeyDown={ onResizeKeyDown }
			/>
			<RowDetailSidebar.Slot
				bubblesVirtually
				className="cortext-row-detail-sidebar"
			/>
		</div>
	);
}
