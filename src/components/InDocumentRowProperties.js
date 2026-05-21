import { useCallback, useRef } from '@wordpress/element';

import RowProperties from './RowProperties';
import { useDocumentPropertiesContext } from './DocumentPropertiesContext';

// Class on the wrapper created by the editor filter. The wrapper is relative so
// the slot can anchor itself to the bottom of the title block.
const HOST_CLASS = 'cortext-document-properties-host';

// Renders row properties as editor chrome between the title and body.
//
// The slot is absolutely positioned inside the title wrapper. To keep
// Gutenberg's between-block inserter below the visible properties, we pad the
// title block by the slot height plus the title's normal bottom margin. A
// ResizeObserver keeps that padding current as field rows change.
//
// `src/editor/filters/document-properties-slot.js` installs the wrapper.
export default function InDocumentRowProperties() {
	const ctx = useDocumentPropertiesContext();
	const cleanupRef = useRef( null );

	const slotRefCallback = useCallback( ( slot ) => {
		// Detach the previous observer and restore the title padding before
		// wiring a new slot node, or before unmount.
		if ( cleanupRef.current ) {
			cleanupRef.current();
			cleanupRef.current = null;
		}
		if ( ! slot ) {
			return;
		}
		const wrapper = slot.closest( `.${ HOST_CLASS }` );
		if ( ! wrapper ) {
			return;
		}
		const titleEl = wrapper.querySelector( ':scope > [data-block]' );
		if ( ! titleEl ) {
			return;
		}
		const observer = new window.ResizeObserver( () => {
			// Preserve the theme's normal gap between the title and the next
			// block, then add the measured slot height.
			const gap =
				parseFloat( window.getComputedStyle( titleEl ).marginBottom ) ||
				0;
			titleEl.style.paddingBottom = `${ slot.offsetHeight + gap }px`;
		} );
		observer.observe( slot );
		cleanupRef.current = () => {
			observer.disconnect();
			titleEl.style.removeProperty( 'padding-bottom' );
		};
	}, [] );

	if ( ! ctx ) {
		return null;
	}
	const { fields, fallbackRecord, isResolving, isVisible } = ctx;
	if ( isResolving || ! isVisible ) {
		return null;
	}
	if ( ! Array.isArray( fields ) || fields.length === 0 ) {
		return null;
	}

	return (
		<div
			ref={ slotRefCallback }
			// `RowProperties` still relies on rules nested under
			// `.cortext-row-detail`. Keep the dedicated class for public render
			// styles and in-document overrides.
			className="cortext-document-properties cortext-row-detail"
			style={ {
				position: 'absolute',
				left: 0,
				right: 0,
				bottom: 0,
			} }
		>
			<RowProperties fields={ fields } row={ fallbackRecord } />
		</div>
	);
}

// Keep the editor filter and slot anchored to the same wrapper class.
export { HOST_CLASS };
