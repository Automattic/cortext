import apiFetch from '@wordpress/api-fetch';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from '@wordpress/element';

const WorkspaceHomeContext = createContext( null );

export function WorkspaceHomeProvider( { children } ) {
	const [ home, setHomeState ] = useState( null );
	const [ isResolving, setIsResolving ] = useState( true );
	const [ isUpdating, setIsUpdating ] = useState( false );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		let cancelled = false;
		setIsResolving( true );
		setError( null );

		apiFetch( { path: '/cortext/v1/workspace-home' } )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				setHomeState( response?.home ?? null );
				setIsResolving( false );
			} )
			.catch( ( nextError ) => {
				if ( cancelled ) {
					return;
				}
				setHomeState( null );
				setError( nextError );
				setIsResolving( false );
			} );

		return () => {
			cancelled = true;
		};
	}, [] );

	const setHome = useCallback( async ( target ) => {
		setIsUpdating( true );
		setError( null );
		try {
			const response = await apiFetch( {
				path: '/cortext/v1/workspace-home',
				method: 'PUT',
				data: target,
			} );
			setHomeState( response?.home ?? null );
			return response?.home ?? null;
		} catch ( nextError ) {
			setError( nextError );
			throw nextError;
		} finally {
			setIsUpdating( false );
		}
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
