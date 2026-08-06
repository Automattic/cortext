import {
	useCallback,
	useLayoutEffect,
	useRef,
	useState,
} from '@wordpress/element';

// Rects use the viewport of their own document. Move the anchor's right edge
// into the panel's document before comparing them.
export function getElementRightInDocument( element, targetDocument ) {
	let currentDocument = element?.ownerDocument;
	let right = element?.getBoundingClientRect().right;

	if ( ! currentDocument || ! Number.isFinite( right ) ) {
		return null;
	}

	while ( currentDocument !== targetDocument ) {
		let frameElement;
		try {
			frameElement = currentDocument.defaultView?.frameElement;
		} catch {
			return null;
		}
		if ( ! frameElement ) {
			return null;
		}

		const frameRect = frameElement.getBoundingClientRect();
		let cssWidth = 0;
		let paddingLeft = 0;
		try {
			const style =
				frameElement.ownerDocument.defaultView?.getComputedStyle(
					frameElement
				);
			cssWidth = parseFloat( style?.width ) || 0;
			paddingLeft = parseFloat( style?.paddingLeft ) || 0;
		} catch {}
		if ( Math.round( cssWidth ) !== frameElement.offsetWidth ) {
			cssWidth = frameElement.offsetWidth;
		}
		let scaleX = frameRect.width / cssWidth;
		if ( ! scaleX || ! Number.isFinite( scaleX ) ) {
			scaleX = 1;
		}
		right =
			frameRect.left +
			( ( frameElement.clientLeft || 0 ) + paddingLeft + right ) * scaleX;
		currentDocument = frameElement.ownerDocument;
	}

	return right;
}

// Picks a `Popover` placement for a row submenu inside a cascading menu,
// adjusting after render if the chosen side overflows the viewport.
// See docs/tech-debt.md#td-wp-menu-popover-limitations.
// `@wordpress/components` `Popover` only flips on the main axis and shifts
// on the cross axis, so a `right-start` submenu that overflows past the
// viewport's right edge wouldn't be pulled back into view on its own.
//
// Strategy (recomputed every time a submenu opens):
//   1. If the outer panel landed to the right of its anchor (normal), start
//      with `right-start`. If it flipped to the left of the anchor (column
//      near right edge), start with `left-start` to keep the submenu clear
//      of the column dropdown.
//   2. After paint, measure the submenu rect. If it clipped right, switch
//      to `left-start`. If left-start clips left, fall back to `bottom-start`.
//
// `outerAnchor` is the element the outer popover is anchored to (e.g. the
// "Calculate" / "Format" menu item in the column header). `panelRef`
// points at the outer panel div whose horizontal position decides
// whether the inner submenu starts on the right or the left.
//
// Returns the inner submenu wrapper ref, the current open key, the
// placement to pass to `Popover`, and an `open(key)` setter.
export function useSubmenuPlacement( outerAnchor, panelRef ) {
	const [ placement, setPlacement ] = useState( 'right-start' );
	const [ openKey, setOpenKey ] = useState( null );
	const submenuRef = useRef( null );

	const open = useCallback(
		( key ) => {
			if ( key === null ) {
				setOpenKey( null );
				return;
			}
			const panel = panelRef.current;
			if ( panel && outerAnchor ) {
				const panelLeft = panel.getBoundingClientRect().left;
				const anchorRight = getElementRightInDocument(
					outerAnchor,
					panel.ownerDocument
				);
				const outerFlipped =
					anchorRight !== null && panelLeft + 1 < anchorRight;
				setPlacement( outerFlipped ? 'left-start' : 'right-start' );
			}
			setOpenKey( key );
		},
		[ outerAnchor, panelRef ]
	);

	useLayoutEffect( () => {
		if ( ! openKey ) {
			return;
		}
		const submenu = submenuRef.current;
		if ( ! submenu ) {
			return;
		}
		const rect = submenu.getBoundingClientRect();
		const viewportWidth =
			submenu.ownerDocument.defaultView?.innerWidth ?? window.innerWidth;
		if ( placement === 'right-start' && rect.right > viewportWidth ) {
			setPlacement( 'left-start' );
			return;
		}
		if ( placement === 'left-start' && rect.left < 0 ) {
			setPlacement( 'bottom-start' );
		}
	}, [ openKey, placement ] );

	return { submenuRef, placement, openKey, open };
}
