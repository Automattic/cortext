import { useCallback, useEffect, useMemo, useRef } from '@wordpress/element';

const DOCUMENT_ID_ATTRIBUTE = 'data-cortext-document-id';

function afterCurrentActivation( callback ) {
	Promise.resolve().then( callback );
}

function belongsToDocumentSource( target, intent ) {
	if ( ! target || ! intent ) {
		return false;
	}
	if (
		target === intent.originElement ||
		intent.originElement?.contains?.( target )
	) {
		return true;
	}

	const source = target.closest?.( `[${ DOCUMENT_ID_ATTRIBUTE }]` );
	return (
		source?.getAttribute( DOCUMENT_ID_ATTRIBUTE ) ===
		String( intent.documentId )
	);
}

/**
 * Preserve keyboard focus when a lifecycle action moves a document out of its
 * current list. Pointer activation never creates an intent, and later pointer,
 * focus, click, or window activity cancels a pending request.
 */
export default function useLifecycleTabFocusIntent() {
	const pendingIntentRef = useRef( null );
	const activationRef = useRef( null );
	const nextTokenRef = useRef( 0 );

	const cancel = useCallback( ( intent = null ) => {
		if ( intent && pendingIntentRef.current !== intent ) {
			return;
		}
		pendingIntentRef.current = null;
	}, [] );

	const capture = useCallback(
		( record ) => {
			const activation = activationRef.current;
			activationRef.current = null;
			cancel();
			if ( ! activation?.fromKeyboard ) {
				return null;
			}

			const intent = {
				token: ++nextTokenRef.current,
				documentId: record?.id,
				originElement: activation.originElement,
				armed: false,
			};
			pendingIntentRef.current = intent;
			afterCurrentActivation( () => {
				if ( pendingIntentRef.current === intent ) {
					intent.armed = true;
				}
			} );
			return intent;
		},
		[ cancel ]
	);

	const consume = useCallback( ( intent ) => {
		if ( ! intent || pendingIntentRef.current !== intent ) {
			return false;
		}
		pendingIntentRef.current = null;
		return true;
	}, [] );

	useEffect( () => {
		if (
			typeof document === 'undefined' ||
			typeof window === 'undefined'
		) {
			return undefined;
		}

		const handleClick = ( event ) => {
			cancel();
			const activation = {
				fromKeyboard: event.detail === 0,
				originElement: event.target,
			};
			activationRef.current = activation;
			window.setTimeout( () => {
				if ( activationRef.current === activation ) {
					activationRef.current = null;
				}
			}, 0 );
		};
		const handlePointerDown = () => {
			activationRef.current = null;
			cancel();
		};
		const handleFocusIn = ( event ) => {
			const intent = pendingIntentRef.current;
			if (
				intent?.armed &&
				! belongsToDocumentSource( event.target, intent )
			) {
				cancel( intent );
			}
		};
		const handleWindowBlur = ( event ) => {
			if ( event.target === window ) {
				cancel();
			}
		};

		document.addEventListener( 'click', handleClick, true );
		document.addEventListener( 'pointerdown', handlePointerDown, true );
		document.addEventListener( 'focusin', handleFocusIn, true );
		window.addEventListener( 'blur', handleWindowBlur, true );
		return () => {
			document.removeEventListener( 'click', handleClick, true );
			document.removeEventListener(
				'pointerdown',
				handlePointerDown,
				true
			);
			document.removeEventListener( 'focusin', handleFocusIn, true );
			window.removeEventListener( 'blur', handleWindowBlur, true );
			pendingIntentRef.current = null;
			activationRef.current = null;
		};
	}, [ cancel ] );

	return useMemo(
		() => ( { capture, consume, cancel } ),
		[ capture, consume, cancel ]
	);
}
