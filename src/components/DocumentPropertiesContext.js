import { createContext, useContext, useMemo } from '@wordpress/element';

// Passes row fields and the fallback record to the document-properties block
// without threading those props through every editor layer.
//
// Canvas sets this up for full-page rows; RowEditor sets it up for detail
// panes. Pages and rows without fields have no provider, so consumers get null.
const DocumentPropertiesContext = createContext( null );

export function DocumentPropertiesProvider( {
	collectionId,
	fields,
	allFields,
	detailLayoutEntries,
	fallbackRecord,
	isResolving = false,
	isVisible = true,
	onToggleVisible,
	children,
} ) {
	const value = useMemo(
		() => ( {
			collectionId,
			fields,
			allFields,
			detailLayoutEntries,
			fallbackRecord,
			isResolving,
			isVisible,
			onToggleVisible,
		} ),
		[
			collectionId,
			fields,
			allFields,
			detailLayoutEntries,
			fallbackRecord,
			isResolving,
			isVisible,
			onToggleVisible,
		]
	);
	return (
		<DocumentPropertiesContext.Provider value={ value }>
			{ children }
		</DocumentPropertiesContext.Provider>
	);
}

// Returns null outside row-property surfaces. The block can be asked to render
// in any editor, including pages.
export function useDocumentPropertiesContext() {
	return useContext( DocumentPropertiesContext );
}
