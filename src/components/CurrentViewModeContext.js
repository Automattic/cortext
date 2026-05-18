import { createContext, useContext } from '@wordpress/element';

import {
	DEFAULT_ROW_DETAIL_MODE,
	normalizeRowDetailMode,
} from './rowDetailUtils';

// Exposes the row detail mode (side / modal / full) of the surface that
// renders the consumer. The collection table provides its `view.rowDetailMode`;
// an open peek provides its own mode. Relation chips read this to decide
// `preferredMode` when opening a row.
const CurrentViewModeContext = createContext( DEFAULT_ROW_DETAIL_MODE );

export function CurrentViewModeProvider( { value, children } ) {
	return (
		<CurrentViewModeContext.Provider
			value={ normalizeRowDetailMode( value ) }
		>
			{ children }
		</CurrentViewModeContext.Provider>
	);
}

export function useCurrentViewMode() {
	return useContext( CurrentViewModeContext );
}
