function prefersReducedMotion( ownerWindow = window ) {
	return (
		typeof ownerWindow !== 'undefined' &&
		ownerWindow.matchMedia?.( '(prefers-reduced-motion: reduce)' ).matches
	);
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

function createInlineEndTracker( ownerWindow, wrapper ) {
	let previousTarget;
	let lastApplied;
	let stableFrames = 0;
	let frameCount = 0;

	const setScrollLeft = ( value ) => {
		wrapper.scrollLeft = value;
		lastApplied = value;
	};

	const track = () => {
		// Stop following the edge if the user scrolls away while columns settle.
		if (
			lastApplied !== undefined &&
			Math.abs( wrapper.scrollLeft - lastApplied ) > 2
		) {
			return;
		}

		const target = inlineEndTarget( wrapper, ownerWindow );
		const targetIsStable =
			previousTarget !== undefined &&
			Math.abs( target - previousTarget ) <= 2;
		previousTarget = target;
		setScrollLeft( target );

		stableFrames = targetIsStable ? stableFrames + 1 : 0;
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

export function scrollToEndQuickly( wrapper ) {
	const ownerWindow = wrapper.ownerDocument?.defaultView ?? window;
	const endTarget = () => inlineEndTarget( wrapper, ownerWindow );
	const target = endTarget();
	const start = wrapper.scrollLeft;

	const tracker = createInlineEndTracker( ownerWindow, wrapper );

	if ( prefersReducedMotion( ownerWindow ) ) {
		tracker.setScrollLeft( target );
		ownerWindow.requestAnimationFrame( tracker.track );
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
			start + ( currentTarget - start ) * easeOutCubic( progress )
		);
		if ( progress < 1 ) {
			ownerWindow.requestAnimationFrame( animate );
		} else {
			ownerWindow.requestAnimationFrame( tracker.track );
		}
	};
	ownerWindow.requestAnimationFrame( animate );
}
