import apiFetch from '@wordpress/api-fetch';
import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from '@wordpress/element';

const FavoritesContext = createContext( null );

function normalizeFavorite( favorite ) {
	if ( ! favorite || ! favorite.kind || ! favorite.id ) {
		return null;
	}
	return {
		...favorite,
		kind: favorite.kind,
		id: Number( favorite.id ),
	};
}

function normalizeFavorites( favorites ) {
	if ( ! Array.isArray( favorites ) ) {
		return [];
	}
	return favorites.map( normalizeFavorite ).filter( Boolean );
}

export function FavoritesProvider( { children } ) {
	const [ favorites, setFavoritesState ] = useState( [] );
	const [ isResolving, setIsResolving ] = useState( true );
	const [ isUpdating, setIsUpdating ] = useState( false );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		let cancelled = false;
		setIsResolving( true );
		setError( null );

		apiFetch( { path: '/cortext/v1/favorites' } )
			.then( ( response ) => {
				if ( cancelled ) {
					return;
				}
				setFavoritesState( normalizeFavorites( response?.favorites ) );
				setIsResolving( false );
			} )
			.catch( ( nextError ) => {
				if ( cancelled ) {
					return;
				}
				setFavoritesState( [] );
				setError( nextError );
				setIsResolving( false );
			} );

		return () => {
			cancelled = true;
		};
	}, [] );

	const setFavorites = useCallback( async ( nextFavorites ) => {
		const normalized = normalizeFavorites( nextFavorites );
		let previous;
		setFavoritesState( ( current ) => {
			previous = current;
			return normalized;
		} );
		setIsUpdating( true );
		setError( null );
		try {
			const response = await apiFetch( {
				path: '/cortext/v1/favorites',
				method: 'PUT',
				data: { favorites: normalized },
			} );
			const saved = normalizeFavorites( response?.favorites );
			setFavoritesState( saved );
			return saved;
		} catch ( nextError ) {
			setFavoritesState( previous ?? [] );
			setError( nextError );
			throw nextError;
		} finally {
			setIsUpdating( false );
		}
	}, [] );

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
