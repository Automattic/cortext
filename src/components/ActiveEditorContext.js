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
	registerPendingSaves: () => () => {},
	flushActiveEditor: async () => true,
};

const ActiveEditorContext = createContext( NO_ACTIVE_EDITOR );

export function ActiveEditorProvider( { children } ) {
	const activeEditorApiRef = useRef( null );
	const peekEditorApiRef = useRef( null );
	// Saves that live outside the block editor, such as row properties, so a
	// lifecycle action can wait for them before changing the document.
	const pendingSaveFlushersRef = useRef( new Set() );

	const registerActiveEditor = useCallback( ( api ) => {
		activeEditorApiRef.current = api;
	}, [] );

	const registerPeekEditor = useCallback( ( api ) => {
		peekEditorApiRef.current = api;
	}, [] );

	const registerPendingSaves = useCallback( ( flush ) => {
		pendingSaveFlushersRef.current.add( flush );
		return () => pendingSaveFlushersRef.current.delete( flush );
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
		for ( const flush of [ ...pendingSaveFlushersRef.current ] ) {
			if ( ( await flush() ) === false ) {
				return false;
			}
		}
		return true;
	}, [] );

	const value = useMemo(
		() => ( {
			registerActiveEditor,
			registerPeekEditor,
			registerPendingSaves,
			flushActiveEditor,
		} ),
		[
			registerActiveEditor,
			registerPeekEditor,
			registerPendingSaves,
			flushActiveEditor,
		]
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
