import { createContext, useContext } from '@wordpress/element';

// The context object lives apart from its provider so field menus can read
// it without loading the provider's data hooks.
const CollectionFieldsContext = createContext( null );

export default CollectionFieldsContext;

// Whether the surrounding collection is frozen. False outside a provider.
export function useIsSchemaFrozen() {
	return Boolean( useContext( CollectionFieldsContext )?.isSchemaFrozen );
}
