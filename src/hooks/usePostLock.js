import apiFetch from '@wordpress/api-fetch';
import { store as coreDataStore } from '@wordpress/core-data';
import { useDispatch, useSelect } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { addAction, removeAction } from '@wordpress/hooks';
import { __ } from '@wordpress/i18n';

const POST_LOCK_HEARTBEAT_NUDGE_MS = 5000;
const heartbeatNudgeRefs = new Set();
let heartbeatNudgeTimerId = null;

function hasVisibleDocument() {
	return (
		typeof document === 'undefined' || document.visibilityState !== 'hidden'
	);
}

function hasOwnedPostLock() {
	for ( const ref of heartbeatNudgeRefs ) {
		if ( ref.current?.activePostLock ) {
			return true;
		}
	}
	return false;
}

function nudgePostLockHeartbeat() {
	if ( ! hasVisibleDocument() || ! hasOwnedPostLock() ) {
		return;
	}

	window.wp?.heartbeat?.connectNow?.();
}

function registerHeartbeatNudgeRef( ref ) {
	if ( typeof window === 'undefined' ) {
		return () => {};
	}

	heartbeatNudgeRefs.add( ref );
	if ( heartbeatNudgeTimerId === null ) {
		heartbeatNudgeTimerId = window.setInterval(
			nudgePostLockHeartbeat,
			POST_LOCK_HEARTBEAT_NUDGE_MS
		);
	}

	return () => {
		heartbeatNudgeRefs.delete( ref );
		if ( heartbeatNudgeRefs.size === 0 && heartbeatNudgeTimerId !== null ) {
			window.clearInterval( heartbeatNudgeTimerId );
			heartbeatNudgeTimerId = null;
		}
	};
}

function defaultPostLockUtils() {
	return globalThis?.cortextEditorSettings?.postLockUtils ?? null;
}

function errorMessage( error ) {
	return (
		error?.message ??
		__( "Couldn't check whether this document is locked.", 'cortext' )
	);
}

function lockUserFromHeartbeat( lockError ) {
	return {
		name: lockError?.name ?? __( 'Someone', 'cortext' ),
		avatar: lockError?.avatar_src_2x ?? lockError?.avatar ?? undefined,
	};
}

function sendReleaseRequest( { activePostLock, postId, postLockUtils } ) {
	if ( ! activePostLock || ! postId || ! postLockUtils?.ajaxUrl ) {
		return;
	}

	const data = new window.FormData();
	data.append( 'action', 'wp-remove-post-lock' );
	data.append( '_wpnonce', postLockUtils.unlockNonce ?? '' );
	data.append( 'post_ID', postId );
	data.append( 'active_post_lock', activePostLock );

	if ( window.navigator?.sendBeacon ) {
		window.navigator.sendBeacon( postLockUtils.ajaxUrl, data );
		return;
	}

	const xhr = new window.XMLHttpRequest();
	xhr.open( 'POST', postLockUtils.ajaxUrl, false );
	xhr.send( data );
}

export default function usePostLock( {
	postId,
	postType,
	enabled = true,
} = {} ) {
	const hookNameRef = useRef( null );
	if ( ! hookNameRef.current ) {
		hookNameRef.current =
			'cortext/post-lock-' + Math.random().toString( 36 ).slice( 2 );
	}

	const { autosave, updatePostLock } = useDispatch( editorStore );
	const { clearEntityRecordEdits, receiveEntityRecords } =
		useDispatch( coreDataStore );
	const [ isAcquiring, setIsAcquiring ] = useState( false );
	const [ isTakingOver, setIsTakingOver ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ checkedPostId, setCheckedPostId ] = useState( null );
	const [ postLockUtils, setPostLockUtils ] =
		useState( defaultPostLockUtils );
	const requestIdRef = useRef( 0 );

	const { isLocked, isTakeover, settingsPostLockUtils, user } = useSelect(
		( select ) => {
			const editor = select( editorStore );
			const editorSettings = editor.getEditorSettings?.() ?? {};
			return {
				isLocked: editor.isPostLocked?.() ?? false,
				isTakeover: editor.isPostLockTakeover?.() ?? false,
				settingsPostLockUtils: editorSettings.postLockUtils ?? null,
				user: editor.getPostLockUser?.() ?? null,
			};
		},
		[]
	);
	const postLockUtilsRef = useRef( postLockUtils );
	postLockUtilsRef.current =
		postLockUtils ?? settingsPostLockUtils ?? defaultPostLockUtils();

	const ownedLockRef = useRef( null );

	const rememberOwnedLock = useCallback(
		( lock, lockPostId, lockPostLockUtils ) => {
			if ( lock?.activePostLock && ! lock?.isLocked ) {
				ownedLockRef.current = {
					activePostLock: lock.activePostLock,
					postId: lockPostId,
					postLockUtils: lockPostLockUtils,
				};
				return;
			}

			if ( ownedLockRef.current?.postId === lockPostId ) {
				ownedLockRef.current = null;
			}
		},
		[]
	);

	const releasePostLock = useCallback( () => {
		const current = ownedLockRef.current;
		if ( ! current?.activePostLock ) {
			return;
		}

		sendReleaseRequest( current );
		ownedLockRef.current = null;
	}, [] );

	const acquireLock = useCallback(
		async ( { force = false } = {} ) => {
			if ( ! enabled || ! postId ) {
				return null;
			}

			const requestId = requestIdRef.current + 1;
			requestIdRef.current = requestId;
			setError( null );
			setIsAcquiring( ! force );
			setIsTakingOver( force );

			try {
				const response = await apiFetch( {
					path: `/cortext/v1/documents/${ postId }/lock`,
					method: 'POST',
					data: force ? { force: true } : {},
				} );

				if ( requestId !== requestIdRef.current ) {
					return response;
				}

				const nextPostLockUtils =
					response?.postLockUtils ?? postLockUtilsRef.current;
				if ( response?.postLockUtils ) {
					setPostLockUtils( response.postLockUtils );
				}
				setCheckedPostId( postId );
				if ( force && response?.post ) {
					const entityPostType = response.post.type ?? postType;
					if ( entityPostType ) {
						clearEntityRecordEdits?.(
							'postType',
							entityPostType,
							postId
						);
						receiveEntityRecords?.(
							'postType',
							entityPostType,
							[ response.post ],
							undefined,
							true
						);
					}
				}
				if ( response?.postLock ) {
					updatePostLock?.( response.postLock );
					rememberOwnedLock(
						response.postLock,
						postId,
						nextPostLockUtils
					);
				}

				return response;
			} catch ( err ) {
				if ( requestId === requestIdRef.current ) {
					setError( errorMessage( err ) );
					setCheckedPostId( postId );
				}
				return null;
			} finally {
				if ( requestId === requestIdRef.current ) {
					setIsAcquiring( false );
					setIsTakingOver( false );
				}
			}
		},
		[
			clearEntityRecordEdits,
			enabled,
			postId,
			postType,
			receiveEntityRecords,
			rememberOwnedLock,
			updatePostLock,
		]
	);

	const retry = useCallback( () => acquireLock(), [ acquireLock ] );
	const takeOver = useCallback(
		() => acquireLock( { force: true } ),
		[ acquireLock ]
	);

	useEffect( () => {
		if ( ! enabled || ! postId ) {
			setError( null );
			setIsAcquiring( false );
			setIsTakingOver( false );
			setCheckedPostId( null );
			return undefined;
		}

		acquireLock();

		return () => {
			requestIdRef.current += 1;
			releasePostLock();
			updatePostLock?.( { isLocked: false } );
		};
	}, [ acquireLock, enabled, postId, releasePostLock, updatePostLock ] );

	useEffect( () => {
		if ( ! enabled || ! postId ) {
			return undefined;
		}

		const hookName = hookNameRef.current;

		function sendPostLock( data ) {
			const current = ownedLockRef.current;
			if ( ! current?.activePostLock || current.postId !== postId ) {
				return;
			}

			data[ 'wp-refresh-post-lock' ] = {
				lock: current.activePostLock,
				post_id: current.postId,
			};
		}

		function receivePostLock( data ) {
			const received = data?.[ 'wp-refresh-post-lock' ];
			if ( ! received ) {
				return;
			}

			if ( received.lock_error ) {
				autosave?.();
				if ( ownedLockRef.current?.postId === postId ) {
					ownedLockRef.current = null;
				}
				updatePostLock?.( {
					isLocked: true,
					isTakeover: true,
					user: lockUserFromHeartbeat( received.lock_error ),
				} );
				return;
			}

			if ( received.new_lock ) {
				rememberOwnedLock(
					{
						activePostLock: received.new_lock,
						isLocked: false,
					},
					postId,
					postLockUtilsRef.current
				);
				updatePostLock?.( {
					isLocked: false,
					activePostLock: received.new_lock,
				} );
			}
		}

		addAction( 'heartbeat.send', hookName, sendPostLock );
		addAction( 'heartbeat.tick', hookName, receivePostLock );
		window.addEventListener( 'beforeunload', releasePostLock );
		const unregisterHeartbeatNudge =
			registerHeartbeatNudgeRef( ownedLockRef );

		return () => {
			removeAction( 'heartbeat.send', hookName );
			removeAction( 'heartbeat.tick', hookName );
			window.removeEventListener( 'beforeunload', releasePostLock );
			unregisterHeartbeatNudge();
		};
	}, [
		autosave,
		enabled,
		postId,
		releasePostLock,
		rememberOwnedLock,
		updatePostLock,
	] );

	const isPendingLockCheck =
		!! enabled && !! postId && checkedPostId !== postId;

	return {
		error,
		isAcquiring,
		isFailed: !! error,
		isLocked,
		isReadOnly: isPendingLockCheck || isAcquiring || !! error || isLocked,
		isTakeover,
		isTakingOver,
		retry,
		takeOver,
		user,
	};
}
