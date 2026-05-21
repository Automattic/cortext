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
	useTrashCascadeEffects,
} from './hooks';
export { documentTitle } from './title';
export { favoriteIdentForRecord, favoriteKeyForRecord } from './favorites';
