import { resolveSelect } from '@wordpress/data';
import {
	createContext,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';

const NO_ACTIVE_EDITOR = {
	registerActiveEditor: () => {},
	registerPeekEditor: () => {},
	registerPendingSaves: () => () => {},
	flushActiveEditor: async () => true,
	lockEditors: () => () => {},
	waitForOpenDocuments: async () => {},
};

const ActiveEditorContext = createContext( NO_ACTIVE_EDITOR );

// Kept apart from the API context so locking re-renders only the editors.
const EditorsLockedContext = createContext( false );

export function ActiveEditorProvider( { children } ) {
	const activeEditorApiRef = useRef( null );
	const peekEditorApiRef = useRef( null );
	// Saves that live outside the block editor, such as row properties, so a
	// lifecycle action can wait for them before changing the document.
	const pendingSaveFlushersRef = useRef( new Set() );
	// Lifecycle requests that hold the open editors read-only. A count, so
	// overlapping requests keep the editors locked until the last one ends.
	const [ lockCount, setLockCount ] = useState( 0 );

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

	const lockEditors = useCallback( () => {
		setLockCount( ( count ) => count + 1 );
		let isReleased = false;
		return () => {
			if ( isReleased ) {
				return;
			}
			isReleased = true;
			setLockCount( ( count ) => count - 1 );
		};
	}, [] );

	// Resolves once every open editor showing one of `ids` has reloaded its
	// document, so it picks up a status changed on the server by a cascade.
	const waitForOpenDocuments = useCallback( async ( ids ) => {
		const documentIds = new Set( [ ...ids ].map( Number ) );
		const reloads = [ activeEditorApiRef.current, peekEditorApiRef.current ]
			.filter(
				( api ) =>
					api?.postType && documentIds.has( Number( api.postId ) )
			)
			.map( ( api ) =>
				resolveSelect( 'core' ).getEntityRecord(
					'postType',
					api.postType,
					api.postId
				)
			);
		await Promise.allSettled( reloads );
	}, [] );

	const value = useMemo(
		() => ( {
			registerActiveEditor,
			registerPeekEditor,
			registerPendingSaves,
			flushActiveEditor,
			lockEditors,
			waitForOpenDocuments,
		} ),
		[
			registerActiveEditor,
			registerPeekEditor,
			registerPendingSaves,
			flushActiveEditor,
			lockEditors,
			waitForOpenDocuments,
		]
	);

	return (
		<ActiveEditorContext.Provider value={ value }>
			<EditorsLockedContext.Provider value={ lockCount > 0 }>
				{ children }
			</EditorsLockedContext.Provider>
		</ActiveEditorContext.Provider>
	);
}

export function useActiveEditor() {
	return useContext( ActiveEditorContext );
}

// True while an archive or trash request holds the open editors read-only.
export function useEditorsLocked() {
	return useContext( EditorsLockedContext );
}
