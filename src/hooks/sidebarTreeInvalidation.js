export const SIDEBAR_TREE_CHANGED_EVENT = 'cortext:sidebar-tree-changed';

export function notifySidebarTreeChanged( detail = {} ) {
	if ( typeof window === 'undefined' ) {
		return;
	}
	window.dispatchEvent(
		new CustomEvent( SIDEBAR_TREE_CHANGED_EVENT, { detail } )
	);
}
