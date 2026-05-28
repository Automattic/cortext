import { computeDocumentUri } from '../router/useResolveEntity';

export function documentUri( record ) {
	return record?.id ? computeDocumentUri( record ) : null;
}
