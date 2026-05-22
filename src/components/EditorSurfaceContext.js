import { createContext, useContext, useMemo } from '@wordpress/element';

const DEFAULT_EDITOR_SURFACE = {
	hasBlockInspector: true,
};

const EditorSurfaceContext = createContext( DEFAULT_EDITOR_SURFACE );

export function EditorSurfaceProvider( {
	children,
	hasBlockInspector = true,
} ) {
	const value = useMemo(
		() => ( { hasBlockInspector } ),
		[ hasBlockInspector ]
	);

	return (
		<EditorSurfaceContext.Provider value={ value }>
			{ children }
		</EditorSurfaceContext.Provider>
	);
}

export function useEditorSurface() {
	return useContext( EditorSurfaceContext );
}
