import { kindFromRecord } from './kinds';
import { getDescriptor } from './descriptors';

/**
 * Resolve the in-app URI for any document record. Delegates to the matching
 * descriptor's `uri(record)` so callers do not branch on kind themselves.
 *
 * @param {?Object} record Document record (page, collection, or row).
 * @return {?string} URI string, or `null` if the kind has no URI resolver.
 */
export function documentUri( record ) {
	const descriptor = getDescriptor( kindFromRecord( record ) );
	return descriptor.uri?.( record ) ?? null;
}
