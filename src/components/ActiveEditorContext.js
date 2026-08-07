import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
} from '@wordpress/element';

const NO_ACTIVE_EDITOR = {
	registerActiveEditor: () => {},
	registerPeekEditor: () => {},
	flushActiveEditor: async () => true,
};

const ActiveEditorContext = createContext( NO_ACTIVE_EDITOR );

export function ActiveEditorProvider( { children } ) {
	const activeEditorApiRef = useRef( null );
	const peekEditorApiRef = useRef( null );

	const registerActiveEditor = useCallback( ( api ) => {
		activeEditorApiRef.current = api;
	}, [] );

	const registerPeekEditor = useCallback( ( api ) => {
		peekEditorApiRef.current = api;
	}, [] );

	const flushActiveEditor = useCallback( async () => {
		for ( const api of [
			activeEditorApiRef.current,
			peekEditorApiRef.current,
		] ) {
			if ( api?.flushNow && ( await api.flushNow() ) === false ) {
				return false;
			}
		}
		return true;
	}, [] );

	const value = useMemo(
		() => ( {
			registerActiveEditor,
			registerPeekEditor,
			flushActiveEditor,
		} ),
		[ registerActiveEditor, registerPeekEditor, flushActiveEditor ]
	);

	return (
		<ActiveEditorContext.Provider value={ value }>
			{ children }
		</ActiveEditorContext.Provider>
	);
}

export function useActiveEditor() {
	return useContext( ActiveEditorContext );
}
