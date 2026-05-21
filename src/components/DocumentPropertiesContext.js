import { createContext, useContext, useMemo } from '@wordpress/element';

// Provides row schema fields and a fallback record to the editor canvas. This
// keeps Canvas and RowEditor from passing those values through every layer just
// so the in-document properties slot can read them.
//
// Canvas sets it up for full-page rows; RowEditor sets it up for detail panes.
// Pages and rows without schema have no provider, so consumers get `null` and
// render nothing.
const DocumentPropertiesContext = createContext( null );

export function DocumentPropertiesProvider( {
	fields,
	fallbackRecord,
	isResolving = false,
	isVisible = true,
	children,
} ) {
	const value = useMemo(
		() => ( { fields, fallbackRecord, isResolving, isVisible } ),
		[ fields, fallbackRecord, isResolving, isVisible ]
	);
	return (
		<DocumentPropertiesContext.Provider value={ value }>
			{ children }
		</DocumentPropertiesContext.Provider>
	);
}

// Returns `null` when the editor has no row-property context. The global editor
// filter calls this in every editor surface, including pages.
export function useDocumentPropertiesContext() {
	return useContext( DocumentPropertiesContext );
}
