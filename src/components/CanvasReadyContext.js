import { createContext, useContext } from '@wordpress/element';

const EMPTY_SIGNALS = {
	signalCollectionReady: null,
};

const CanvasReadyContext = createContext( EMPTY_SIGNALS );

export function CanvasReadyProvider( { children, value } ) {
	return (
		<CanvasReadyContext.Provider value={ value ?? EMPTY_SIGNALS }>
			{ children }
		</CanvasReadyContext.Provider>
	);
}

export function useCanvasReadySignals() {
	return useContext( CanvasReadyContext ) ?? EMPTY_SIGNALS;
}
