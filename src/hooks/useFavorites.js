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

const FavoritesContext = createContext( null );

function normalizeFavorite( favorite ) {
	if ( ! favorite || ! favorite.id ) {
		return null;
	}
	return {
		...favorite,
		id: Number( favorite.id ),
	};
}

function normalizeFavorites( favorites ) {
	if ( ! Array.isArray( favorites ) ) {
		return [];
	}
	return favorites.map( normalizeFavorite ).filter( Boolean );
}

function areFavoritesEqual( a, b ) {
	if ( a.length !== b.length ) {
		return false;
	}
	return a.every( ( favorite, index ) => favorite.id === b[ index ]?.id );
}

export function FavoritesProvider( { children } ) {
	const [ favorites, setFavoritesState ] = useState( [] );
	const [ isResolving, setIsResolving ] = useState( true );
	const [ isUpdating, setIsUpdating ] = useState( false );
	const [ error, setError ] = useState( null );
	const favoritesRef = useRef( [] );
	const serverFavoritesRef = useRef( [] );
	const initialLoadPromiseRef = useRef( null );
	const initialLoadErrorRef = useRef( null );
	const hasResolvedInitialLoadRef = useRef( false );
	const pendingWritesRef = useRef( 0 );
	const writeChainRef = useRef( Promise.resolve() );

	const applyFavorites = useCallback( ( nextFavorites ) => {
		favoritesRef.current = nextFavorites;
		setFavoritesState( nextFavorites );
	}, [] );

	useEffect( () => {
		let cancelled = false;
		setIsResolving( true );
		setError( null );
		initialLoadErrorRef.current = null;

		const initialLoadPromise = apiFetch( { path: '/cortext/v1/favorites' } )
			.then( ( response ) => {
				const loaded = normalizeFavorites( response?.favorites );
				if ( cancelled ) {
					return loaded;
				}
				serverFavoritesRef.current = loaded;
				applyFavorites( loaded );
				initialLoadErrorRef.current = null;
				hasResolvedInitialLoadRef.current = true;
				setIsResolving( false );
				return loaded;
			} )
			.catch( ( nextError ) => {
				if ( cancelled ) {
					throw nextError;
				}
				applyFavorites( [] );
				initialLoadErrorRef.current = nextError;
				setError( nextError );
				hasResolvedInitialLoadRef.current = true;
				setIsResolving( false );
				throw nextError;
			} );
		initialLoadPromiseRef.current = initialLoadPromise;
		initialLoadPromise.catch( () => {} );

		return () => {
			cancelled = true;
		};
	}, [ applyFavorites ] );

	const setFavorites = useCallback(
		async ( nextFavorites ) => {
			const write = async () => {
				if (
					! hasResolvedInitialLoadRef.current &&
					initialLoadPromiseRef.current
				) {
					await initialLoadPromiseRef.current;
				}
				if ( initialLoadErrorRef.current ) {
					throw initialLoadErrorRef.current;
				}

				const normalized = normalizeFavorites(
					typeof nextFavorites === 'function'
						? nextFavorites( favoritesRef.current )
						: nextFavorites
				);
				if ( areFavoritesEqual( favoritesRef.current, normalized ) ) {
					return favoritesRef.current;
				}
				applyFavorites( normalized );
				pendingWritesRef.current += 1;
				setIsUpdating( true );
				setError( null );

				try {
					const response = await apiFetch( {
						path: '/cortext/v1/favorites',
						method: 'PUT',
						data: { favorites: normalized },
					} );
					const saved = normalizeFavorites( response?.favorites );
					serverFavoritesRef.current = saved;
					if (
						areFavoritesEqual( favoritesRef.current, normalized )
					) {
						applyFavorites( saved );
					}
					return saved;
				} catch ( nextError ) {
					setError( nextError );
					if (
						areFavoritesEqual( favoritesRef.current, normalized )
					) {
						applyFavorites( serverFavoritesRef.current );
					}
					throw nextError;
				} finally {
					pendingWritesRef.current -= 1;
					setIsUpdating( pendingWritesRef.current > 0 );
				}
			};

			const promise = writeChainRef.current.then( write, write );
			writeChainRef.current = promise.catch( () => {} );
			return promise;
		},
		[ applyFavorites ]
	);

	const value = useMemo(
		() => ( { favorites, isResolving, isUpdating, error, setFavorites } ),
		[ favorites, isResolving, isUpdating, error, setFavorites ]
	);

	return (
		<FavoritesContext.Provider value={ value }>
			{ children }
		</FavoritesContext.Provider>
	);
}

export function useFavorites() {
	const value = useContext( FavoritesContext );
	if ( ! value ) {
		throw new Error( 'useFavorites must be used inside FavoritesProvider' );
	}
	return value;
}
