import useDocuments from './useDocuments';
import { useDocumentTrashInvalidation } from './documentTrashInvalidation';

/**
 * Trash uses `/cortext/v1/documents?status=trash`; this hook adds the
 * invalidation refresh used after restore and permanent delete.
 */
export default function useTrashedDocuments() {
	const result = useDocuments( { status: 'trash' } );
	useDocumentTrashInvalidation( result.refresh );
	return result;
}
