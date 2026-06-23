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

// The router resolves a document by the trailing id, so the stored path is only
// cosmetic. Use it when present, otherwise navigate by bare id; the destination
// view canonicalizes its own URL, so there is no per-click lookup.
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
