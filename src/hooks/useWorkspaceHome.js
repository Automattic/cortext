import apiFetch from '@wordpress/api-fetch';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';

import { useDocumentArchiveInvalidation } from './documentArchiveInvalidation';

const WorkspaceHomeContext = createContext( null );

export function WorkspaceHomeProvider( { children } ) {
	const [ home, setHomeState ] = useState( null );
	const [ isResolving, setIsResolving ] = useState( true );
	const [ isUpdating, setIsUpdating ] = useState( false );
	const [ error, setError ] = useState( null );
	const requestIdRef = useRef( 0 );
	const updateRequestIdRef = useRef( 0 );
	const writeChainRef = useRef( Promise.resolve() );

	const refreshHome = useCallback( async () => {
		const requestId = requestIdRef.current + 1;
		requestIdRef.current = requestId;
		setIsResolving( true );
		setError( null );

		try {
			const response = await apiFetch( {
				path: '/cortext/v1/workspace-home',
			} );
			if ( requestId !== requestIdRef.current ) {
				return null;
			}
			const nextHome = response?.home ?? null;
			setHomeState( nextHome );
			setIsResolving( false );
			return nextHome;
		} catch ( nextError ) {
			if ( requestId !== requestIdRef.current ) {
				return null;
			}
			setHomeState( null );
			setError( nextError );
			setIsResolving( false );
			return null;
		}
	}, [] );

	useEffect( () => {
		refreshHome();

		return () => {
			requestIdRef.current += 1;
		};
	}, [ refreshHome ] );
	const refreshAfterLifecycleChange = useCallback( () => {
		const refresh = writeChainRef.current.then( refreshHome, refreshHome );
		writeChainRef.current = refresh.catch( () => null );
		return refresh;
	}, [ refreshHome ] );
	useDocumentArchiveInvalidation( refreshAfterLifecycleChange );

	const setHome = useCallback( ( target ) => {
		const write = async () => {
			const requestId = requestIdRef.current + 1;
			requestIdRef.current = requestId;
			const updateRequestId = updateRequestIdRef.current + 1;
			updateRequestIdRef.current = updateRequestId;
			setIsResolving( false );
			setIsUpdating( true );
			setError( null );
			try {
				const response = await apiFetch( {
					path: '/cortext/v1/workspace-home',
					method: 'PUT',
					data: target,
				} );
				if ( requestId === requestIdRef.current ) {
					setHomeState( response?.home ?? null );
				}
				return response?.home ?? null;
			} catch ( nextError ) {
				if ( requestId === requestIdRef.current ) {
					setError( nextError );
				}
				throw nextError;
			} finally {
				if ( updateRequestId === updateRequestIdRef.current ) {
					setIsUpdating( false );
				}
			}
		};

		const promise = writeChainRef.current.then( write, write );
		writeChainRef.current = promise.catch( () => null );
		return promise;
	}, [] );

	const value = useMemo(
		() => ( { home, isResolving, isUpdating, error, setHome } ),
		[ home, isResolving, isUpdating, error, setHome ]
	);

	return (
		<WorkspaceHomeContext.Provider value={ value }>
			{ children }
		</WorkspaceHomeContext.Provider>
	);
}

export function useWorkspaceHome() {
	const value = useContext( WorkspaceHomeContext );
	if ( ! value ) {
		throw new Error(
			'useWorkspaceHome must be used inside WorkspaceHomeProvider'
		);
	}
	return value;
}
