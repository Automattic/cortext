function prefersReducedMotion() {
	return (
		typeof window !== 'undefined' &&
		window.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

function isAtScrollEnd( scrollLeft, target ) {
	return Math.abs( scrollLeft - target ) <= 2;
}

export function scrollToEndQuickly( wrapper, options = {} ) {
	const maxScroll = wrapper.scrollWidth - wrapper.clientWidth;
	const trackEnd = options.trackEnd === true;
	if ( maxScroll <= 0 && ! trackEnd ) {
		return;
	}
	const isRtl = window.getComputedStyle( wrapper ).direction === 'rtl';
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
	if ( prefersReducedMotion() ) {
		wrapper.scrollLeft = target;
		return;
	}

	const distance = target - start;
	if ( distance === 0 && ! trackEnd ) {
		return;
	}

	const duration = 180;
	const startedAt = window.performance.now();
	const easeOutCubic = ( t ) => 1 - Math.pow( 1 - t, 3 );

	const animate = ( now ) => {
		const progress = Math.min( 1, ( now - startedAt ) / duration );
		const currentTarget = endTarget();
		wrapper.scrollLeft =
			start + ( currentTarget - start ) * easeOutCubic( progress );
		if ( progress < 1 ) {
			window.requestAnimationFrame( animate );
		} else {
			wrapper.scrollLeft = currentTarget;
		}
	};
	window.requestAnimationFrame( animate );
}
