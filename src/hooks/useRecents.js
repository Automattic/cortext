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

const RecentsContext = createContext( null );

function recentFingerprint( recent ) {
	return JSON.stringify( [
		recent?.kind,
		recent?.id,
		recent?.title,
		recent?.path,
		recent?.icon,
		recent?.collection?.id,
		recent?.collection?.title,
		recent?.collection?.path,
	] );
}

function areEquivalentRecents( current, next ) {
	if ( current.length !== next.length ) {
		return false;
	}
	return current.every(
		( recent, index ) =>
			recentFingerprint( recent ) === recentFingerprint( next[ index ] )
	);
}

function applyRecents( setRecents, nextRecents ) {
	setRecents( ( current ) =>
		areEquivalentRecents( current, nextRecents ) ? current : nextRecents
	);
}

function recentsFromResponse( response ) {
	return Array.isArray( response?.recents ) ? response.recents : [];
}

export function RecentsProvider( { children } ) {
	const [ recents, setRecents ] = useState( [] );
	const [ isResolving, setIsResolving ] = useState( true );
	const [ isUpdating, setIsUpdating ] = useState( false );
	const [ error, setError ] = useState( null );
	const latestTouchRequest = useRef( 0 );

	useEffect( () => {
		let cancelled = false;
		setIsResolving( true );
		setError( null );

		apiFetch( { path: '/cortext/v1/recents' } )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				if ( latestTouchRequest.current > 0 ) {
					setIsResolving( false );
					return;
				}
				applyRecents( setRecents, recentsFromResponse( response ) );
				setIsResolving( false );
			} )
			.catch( ( nextError ) => {
				if ( cancelled ) {
					return;
				}
				setRecents( [] );
				setError( nextError );
				setIsResolving( false );
			} );

		return () => {
			cancelled = true;
		};
	}, [] );

	const touchRecent = useCallback( async ( target ) => {
		if ( ! target?.kind || ! target?.id ) {
			return null;
		}
		const requestId = latestTouchRequest.current + 1;
		latestTouchRequest.current = requestId;
		setIsUpdating( true );
		setError( null );
		try {
			const response = await apiFetch( {
				path: '/cortext/v1/recents',
				method: 'POST',
				data: target,
			} );
			const nextRecents = recentsFromResponse( response );
			if ( requestId === latestTouchRequest.current ) {
				applyRecents( setRecents, nextRecents );
				setIsResolving( false );
			}
			return nextRecents;
		} catch ( nextError ) {
			if ( requestId === latestTouchRequest.current ) {
				setError( nextError );
				setIsResolving( false );
			}
			return null;
		} finally {
			if ( requestId === latestTouchRequest.current ) {
				setIsUpdating( false );
			}
		}
	}, [] );

	const value = useMemo(
		() => ( { recents, isResolving, isUpdating, error, touchRecent } ),
		[ recents, isResolving, isUpdating, error, touchRecent ]
	);

	return (
		<RecentsContext.Provider value={ value }>
			{ children }
		</RecentsContext.Provider>
	);
}

export function useRecents() {
	const value = useContext( RecentsContext );
	if ( ! value ) {
		throw new Error( 'useRecents must be used inside RecentsProvider' );
	}
	return value;
}
