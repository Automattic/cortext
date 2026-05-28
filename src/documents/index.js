/**
 * Public API for document helpers shared across the sidebar and editor blocks.
 */

export {
	DocumentsProvider,
	useDocumentActions,
	useDocumentRecord,
	useDocumentSelection,
	useFavoriteToggle,
} from './hooks';
export { useCreateDocument } from './actions';
export { documentTitle } from './title';
export { listIconForRecord } from './icons';
export { documentUri } from './uri';
export {
	favoriteKey,
	favoriteIdentForRecord,
	favoriteKeyForRecord,
	filterFavoritesByDeletedIds,
} from './favorites';
