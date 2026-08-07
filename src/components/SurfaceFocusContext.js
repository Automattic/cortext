import {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from '@wordpress/element';

const NO_SURFACE_FOCUS_INTENT = {
	request: null,
	requestFromActivation: () => null,
	cancel: () => {},
	consume: () => false,
};

const SurfaceFocusContext = createContext( NO_SURFACE_FOCUS_INTENT );

/*
 * Stores a one-shot focus request for keyboard activation in the main sidebar.
 * It lives outside router state so back/forward navigation cannot replay it.
 */
export function SurfaceFocusProvider( { children } ) {
	const [ request, setRequest ] = useState( null );
	const requestRef = useRef( null );
	const nextTokenRef = useRef( 0 );

	const cancel = useCallback( () => {
		if ( requestRef.current === null ) {
			return;
		}
		requestRef.current = null;
		setRequest( null );
	}, [] );

	const consume = useCallback( ( token, onConsume ) => {
		if ( requestRef.current?.token !== token ) {
			return false;
		}

		requestRef.current = null;
		// Claim the token, then run the focus callback before updating context.
		// Updating context first can rerender the editor and interrupt focus.
		onConsume?.();
		setRequest( ( current ) =>
			current?.token === token ? null : current
		);
		return true;
	}, [] );

	const requestFromActivation = useCallback(
		( event, documentId ) => {
			// `click.detail === 0` covers keyboard and assistive-technology clicks.
			// Pointer activation leaves focus alone and cancels any pending request.
			if (
				event?.detail !== 0 ||
				documentId === null ||
				documentId === undefined ||
				! event.currentTarget
			) {
				cancel();
				return null;
			}

			const nextRequest = {
				token: ++nextTokenRef.current,
				documentId,
				originElement: event.currentTarget,
			};
			requestRef.current = nextRequest;
			setRequest( nextRequest );
			return nextRequest.token;
		},
		[ cancel ]
	);

	useEffect( () => {
		const handlePopState = () => cancel();
		const handlePointerDown = () => cancel();
		const handleWindowBlur = () => cancel();
		const handleFocusIn = ( event ) => {
			const pending = requestRef.current;
			if ( pending && event.target !== pending.originElement ) {
				cancel();
			}
		};

		// Capture `popstate` before the router publishes the new location.
		window.addEventListener( 'popstate', handlePopState, true );
		window.addEventListener( 'blur', handleWindowBlur, true );
		document.addEventListener( 'pointerdown', handlePointerDown, true );
		document.addEventListener( 'focusin', handleFocusIn, true );
		return () => {
			window.removeEventListener( 'popstate', handlePopState, true );
			window.removeEventListener( 'blur', handleWindowBlur, true );
			document.removeEventListener(
				'pointerdown',
				handlePointerDown,
				true
			);
			document.removeEventListener( 'focusin', handleFocusIn, true );
		};
	}, [ cancel ] );

	const value = useMemo(
		() => ( { request, requestFromActivation, cancel, consume } ),
		[ request, requestFromActivation, cancel, consume ]
	);

	return (
		<SurfaceFocusContext.Provider value={ value }>
			{ children }
		</SurfaceFocusContext.Provider>
	);
}

export function useSurfaceFocusIntent() {
	return useContext( SurfaceFocusContext );
}
