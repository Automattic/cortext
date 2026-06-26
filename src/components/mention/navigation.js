import { MENTION_ATTRIBUTE } from './constants';

export function mentionAnchorFromEvent( event ) {
	if ( event.button !== undefined && event.button !== 0 ) {
		return null;
	}
	if ( event.metaKey || event.ctrlKey || event.shiftKey || event.altKey ) {
		return null;
	}

	const target =
		event.target?.nodeType === 1
			? event.target
			: event.target?.parentElement;
	return target?.closest?.( `a[${ MENTION_ATTRIBUTE }]` ) ?? null;
}

// The router only needs the trailing id. Use the stored path for nicer URLs
// when it exists; otherwise the destination can canonicalize from the id.
export function pathForMentionAnchor( anchor ) {
	const stored = anchor.getAttribute( 'data-crtxt-path' );
	if ( stored ) {
		return stored;
	}

	const id = Number.parseInt(
		anchor.getAttribute( MENTION_ATTRIBUTE ) ?? '',
		10
	);
	return id > 0 ? String( id ) : '';
}

export function navigateToMentionAnchor( anchor, navigate ) {
	const path = pathForMentionAnchor( anchor );
	if ( ! path ) {
		return;
	}

	navigate( {
		to: '/$',
		params: { _splat: path },
	} );
}

function stopMentionEvent( event ) {
	event.preventDefault();
	event.stopPropagation();
	event.stopImmediatePropagation?.();
}

export function handleMentionNavigationEvent( event, navigate ) {
	const anchor = mentionAnchorFromEvent( event );
	if ( ! anchor ) {
		return false;
	}

	stopMentionEvent( event );
	navigateToMentionAnchor( anchor, navigate );
	return true;
}
