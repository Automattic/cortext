/**
 * Public API for sidebar document helpers.
 *
 * Components outside this folder should use these hooks and helpers instead
 * of importing descriptors directly.
 */

export {
	DocumentsProvider,
	useDocumentActions,
	useDocumentRecord,
	useDocumentSelection,
	useFavoriteToggle,
} from './hooks';
export { documentTitle } from './title';
export {
	favoriteKey,
	favoriteIdentForRecord,
	favoriteKeyForRecord,
	filterFavoritesByDeletedIds,
} from './favorites';
