import useDocuments from './useDocuments';
import { useDocumentArchiveInvalidation } from './documentArchiveInvalidation';

/**
 * Fetch archived documents and refresh when a lifecycle action changes them.
 */
export default function useArchivedDocuments() {
	const result = useDocuments( { status: 'crtxt_archived' } );
	useDocumentArchiveInvalidation( result.refresh );
	return result;
}
