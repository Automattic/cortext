function prefersReducedMotion( ownerWindow = window ) {
	return (
		typeof ownerWindow !== 'undefined' &&
		ownerWindow.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

function isAtScrollEnd( scrollLeft, target ) {
	return Math.abs( scrollLeft - target ) <= 2;
}

export function scrollToEndQuickly( wrapper, options = {} ) {
	const ownerWindow = wrapper.ownerDocument?.defaultView ?? window;
	const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
	const trackEnd = options.trackEnd === true;
	if ( maxScroll <= 0 && ! trackEnd ) {
		return;
	}
	const isRtl = ownerWindow.getComputedStyle( wrapper ).direction === 'rtl';
	const endTarget = () => {
		const currentMaxScroll = wrapper.scrollWidth - wrapper.clientWidth;
		return isRtl ? -currentMaxScroll : currentMaxScroll;
	};
	const target = endTarget();
	const start = wrapper.scrollLeft;
	if ( options.snapIfAtEnd ) {
		if ( isAtScrollEnd( start, target ) ) {
			wrapper.scrollLeft = target;
			wrapper.dataset.cortextRevealAtEnd = 'true';
		}
		return;
	}
	if ( wrapper.dataset.cortextRevealAtEnd === 'true' ) {
		delete wrapper.dataset.cortextRevealAtEnd;
		wrapper.scrollLeft = target;
		return;
	}
	const distance = target - start;
	if ( distance === 0 && ! trackEnd ) {
		return;
	}

	const duration = 180;
	const startedAt = ownerWindow.performance.now();
	const easeOutCubic = ( t ) => 1 - Math.pow( 1 - t, 3 );
	const settleUntil = trackEnd ? startedAt + 5000 : 0;

	const settleAtEnd = () => {
		wrapper.scrollLeft = endTarget();
		if ( ownerWindow.performance.now() >= settleUntil ) {
			return;
		}
		ownerWindow.requestAnimationFrame( settleAtEnd );
	};

	if ( prefersReducedMotion( ownerWindow ) ) {
		wrapper.scrollLeft = target;
		if ( trackEnd ) {
			ownerWindow.requestAnimationFrame( settleAtEnd );
		}
		return;
	}

	const animate = ( now ) => {
		const progress = Math.min( 1, ( now - startedAt ) / duration );
		const currentTarget = endTarget();
		wrapper.scrollLeft =
			start + ( currentTarget - start ) * easeOutCubic( progress );
		if ( progress < 1 ) {
			ownerWindow.requestAnimationFrame( animate );
		} else {
			settleAtEnd();
		}
	};
	ownerWindow.requestAnimationFrame( animate );
}

export function scrollElementInlineEndQuickly( element, options = {} ) {
	const ownerWindow = element.ownerDocument?.defaultView ?? window;
	const scrollNodeToInlineEnd = ( node ) => {
		if (
			! node ||
			typeof node.scrollWidth !== 'number' ||
			typeof node.clientWidth !== 'number'
		) {
			return;
		}
		const maxScroll = node.scrollWidth - node.clientWidth;
		if ( maxScroll <= 0 ) {
			return;
		}
		const isRtl = ownerWindow.getComputedStyle( node ).direction === 'rtl';
		node.scrollLeft = isRtl ? -maxScroll : maxScroll;
	};
	const scrollAncestorsToInlineEnd = () => {
		let node = element.parentElement;
		while ( node ) {
			scrollNodeToInlineEnd( node );
			node = node.parentElement;
		}
		scrollNodeToInlineEnd( element.ownerDocument?.scrollingElement );
	};
	const reveal = () => {
		element.scrollIntoView?.( {
			block: 'nearest',
			inline: 'end',
			behavior: 'auto',
		} );
		scrollAncestorsToInlineEnd();
	};

	reveal();
	if ( options.trackEnd !== true ) {
		return;
	}

	const settleUntil = ownerWindow.performance.now() + 5000;
	const settleAtEnd = () => {
		reveal();
		if ( ownerWindow.performance.now() >= settleUntil ) {
			return;
		}
		ownerWindow.requestAnimationFrame( settleAtEnd );
	};
	ownerWindow.requestAnimationFrame( settleAtEnd );
}
