import { createContext, useContext } from '@wordpress/element';

import {
	DEFAULT_ROW_DETAIL_MODE,
	normalizeRowDetailMode,
} from './rowDetailUtils';

// Tracks the row detail mode for whichever row detail view renders a relation
// chip. Tables pass `view.rowDetailMode`; an open peek passes its own mode, so
// nested relation chips open rows in the same style.
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
