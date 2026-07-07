function prefersReducedMotion( ownerWindow = window ) {
	return (
		typeof ownerWindow !== 'undefined' &&
		ownerWindow.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
}

function isAtScrollEnd( scrollLeft, target ) {
	return Math.abs( scrollLeft - target ) <= 2;
}

function inlineEndTarget( node, ownerWindow ) {
	const maxScroll = node.scrollWidth - node.clientWidth;
	if ( maxScroll <= 0 ) {
		return 0;
	}
	const isRtl = ownerWindow.getComputedStyle( node ).direction === 'rtl';
	return isRtl ? -maxScroll : maxScroll;
}

const SCROLL_ANIMATION_DURATION_MS = 180;
const STABLE_SCROLL_FRAME_COUNT = 2;
const MAX_SCROLL_TRACK_FRAMES = 30;

function createInlineEndTracker( ownerWindow, candidates ) {
	const previousTargets = new Map();
	const lastApplied = new Map();
	let stableFrames = 0;
	let frameCount = 0;

	const setScrollLeft = ( candidate, value ) => {
		candidate.scrollLeft = value;
		lastApplied.set( candidate, value );
	};

	const userInterrupted = () =>
		candidates.some( ( candidate ) => {
			if ( ! lastApplied.has( candidate ) ) {
				return false;
			}
			return (
				Math.abs(
					candidate.scrollLeft - lastApplied.get( candidate )
				) > 2
			);
		} );

	const track = () => {
		if ( userInterrupted() ) {
			return;
		}

		let targetsAreStable = true;
		for ( const candidate of candidates ) {
			const target = inlineEndTarget( candidate, ownerWindow );
			const previousTarget = previousTargets.get( candidate );
			if (
				previousTarget === undefined ||
				Math.abs( target - previousTarget ) > 2
			) {
				targetsAreStable = false;
			}
			previousTargets.set( candidate, target );
			setScrollLeft( candidate, target );
		}

		stableFrames = targetsAreStable ? stableFrames + 1 : 0;
		frameCount += 1;
		if (
			stableFrames >= STABLE_SCROLL_FRAME_COUNT ||
			frameCount >= MAX_SCROLL_TRACK_FRAMES
		) {
			return;
		}
		ownerWindow.requestAnimationFrame( track );
	};

	return {
		setScrollLeft,
		track,
	};
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

	const tracker = createInlineEndTracker( ownerWindow, [ wrapper ] );

	if ( prefersReducedMotion( ownerWindow ) ) {
		tracker.setScrollLeft( wrapper, target );
		if ( trackEnd ) {
			ownerWindow.requestAnimationFrame( tracker.track );
		}
		return;
	}

	const startedAt = ownerWindow.performance.now();
	const easeOutCubic = ( t ) => 1 - Math.pow( 1 - t, 3 );
	const animate = ( now ) => {
		const progress = Math.min(
			1,
			( now - startedAt ) / SCROLL_ANIMATION_DURATION_MS
		);
		const currentTarget = endTarget();
		tracker.setScrollLeft(
			wrapper,
			start + ( currentTarget - start ) * easeOutCubic( progress )
		);
		if ( progress < 1 ) {
			ownerWindow.requestAnimationFrame( animate );
		} else if ( trackEnd ) {
			ownerWindow.requestAnimationFrame( tracker.track );
		}
	};
	ownerWindow.requestAnimationFrame( animate );
}

export function scrollElementInlineEndQuickly( element, options = {} ) {
	const ownerWindow = element.ownerDocument?.defaultView ?? window;
	const candidates = [];
	const addCandidate = ( node ) => {
		if (
			! node ||
			typeof node.scrollWidth !== 'number' ||
			typeof node.clientWidth !== 'number'
		) {
			return;
		}
		candidates.push( node );
	};
	let node = element.parentElement;
	while ( node ) {
		addCandidate( node );
		node = node.parentElement;
	}
	addCandidate( element.ownerDocument?.scrollingElement );

	if ( options.trackEnd !== true ) {
		element.scrollIntoView?.( {
			block: 'nearest',
			inline: 'end',
			behavior: 'auto',
		} );
		for ( const candidate of candidates ) {
			candidate.scrollLeft = inlineEndTarget( candidate, ownerWindow );
		}
		return;
	}

	const tracker = createInlineEndTracker( ownerWindow, candidates );

	if ( prefersReducedMotion( ownerWindow ) ) {
		tracker.track();
		return;
	}

	const startByNode = new Map(
		candidates.map( ( candidate ) => [
			candidate,
			candidate.scrollLeft || 0,
		] )
	);
	const startedAt = ownerWindow.performance.now();
	const easeOutCubic = ( t ) => 1 - Math.pow( 1 - t, 3 );

	const applyProgress = ( progress ) => {
		for ( const candidate of candidates ) {
			const start = startByNode.get( candidate ) ?? 0;
			const target = inlineEndTarget( candidate, ownerWindow );
			tracker.setScrollLeft(
				candidate,
				start + ( target - start ) * easeOutCubic( progress )
			);
		}
	};

	const animate = ( now ) => {
		const progress = Math.min(
			1,
			( now - startedAt ) / SCROLL_ANIMATION_DURATION_MS
		);
		applyProgress( progress );
		if ( progress < 1 ) {
			ownerWindow.requestAnimationFrame( animate );
		} else {
			ownerWindow.requestAnimationFrame( tracker.track );
		}
	};
	ownerWindow.requestAnimationFrame( animate );
}
