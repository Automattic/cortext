import collectionDescriptor from './collection';
import pageDescriptor from './page';
import rowDescriptor from './row';

const descriptors = {
	page: pageDescriptor,
	collection: collectionDescriptor,
	row: rowDescriptor,
};

/**
 * Resolve a descriptor for a document kind. Unknown kinds use the row
 * defaults, which expose no sidebar actions.
 *
 * @param {?string} kind Document kind from `kindFromRecord`.
 * @return {Object} Descriptor with `features` and optional action methods.
 */
export function getDescriptor( kind ) {
	return descriptors[ kind ] ?? rowDescriptor;
}
