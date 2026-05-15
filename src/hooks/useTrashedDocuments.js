import useDocuments from './useDocuments';
import { useDocumentTrashInvalidation } from './documentTrashInvalidation';

/**
 * Sidebar Trash view of the unified `/cortext/v1/documents` endpoint. Thin
 * wrapper around `useDocuments` that pins the trash status and refreshes when
 * any trash mutation (restore, permanent delete) fires the invalidation event.
 */
export default function useTrashedDocuments() {
	const result = useDocuments( { status: 'trash' } );
	useDocumentTrashInvalidation( result.refresh );
	return result;
}
