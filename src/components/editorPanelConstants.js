export const INSPECTOR_SCOPE = 'cortext';
export const DOCUMENT_INSPECTOR = 'cortext/document-inspector';
export const BLOCK_INSPECTOR = 'cortext/block-inspector';
export const REVISION_HISTORY_PANEL = 'cortext/revision-history';

export function isInspectorArea( area ) {
	return area === DOCUMENT_INSPECTOR || area === BLOCK_INSPECTOR;
}
