import { createContext, useContext } from '@wordpress/element';

export const RowFullEditorContext = createContext( {
	clearSuppressedRouteRow: null,
	openRowFull: null,
	suppressedRouteRow: null,
} );

export function useRowFullEditor() {
	return useContext( RowFullEditorContext );
}
