import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as coreDataStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { __ } from '@wordpress/i18n';

import { useRecents } from './useRecents';

const DEBOUNCE_MS = 800;
const MIN_SAVE_INTERVAL_MS = 2000;
const AUTOSAVE_ERROR_NOTICE_ID = 'cortext-autosave-error';

export default function useAutosave( options = {} ) {
	const debounceMs = options.debounceMs ?? DEBOUNCE_MS;
	const minSaveIntervalMs = options.minSaveIntervalMs ?? MIN_SAVE_INTERVAL_MS;
	const recentKind = options.recentTarget?.kind ?? null;
	const recentId = options.recentTarget?.id ?? null;
	const recentCollectionId = options.recentTarget?.collectionId ?? null;
	const { savePost, editPost } = useDispatch( editorStore );
	const { createErrorNotice, removeNotice } = useDispatch( noticesStore );
	const { touchRecent } = useRecents();

	const {
		isDirty,
		isSaveable,
		isSaving,
		didSucceed,
		didFail,
		editsReference,
		postStatus,
		postTitle,
		currentPostId,
	} = useSelect( ( select ) => {
		const editor = select( editorStore );
		return {
			isDirty: editor.isEditedPostDirty(),
			isSaveable: editor.isEditedPostSaveable(),
			isSaving: editor.isSavingPost(),
			didSucceed: editor.didPostSaveRequestSucceed(),
			didFail: editor.didPostSaveRequestFail(),
			editsReference:
				select( coreDataStore ).getReferenceByDistinctEdits(),
			postStatus: editor.getEditedPostAttribute( 'status' ),
			postTitle: editor.getEditedPostAttribute( 'title' ),
			currentPostId: editor.getCurrentPostId(),
		};
	}, [] );

	const [ status, setStatus ] = useState( 'idle' );
	const [ lastSavedAt, setLastSavedAt ] = useState( null );

	const debounceRef = useRef( null );
	const lastSaveAtRef = useRef( 0 );
	const savePromiseRef = useRef( null );
	const savingWaitersRef = useRef( [] );
	const prevIsSavingRef = useRef( isSaving );

	const stateRef = useRef( {
		isDirty,
		isSaveable,
		isSaving,
		savePost,
		editPost,
		postStatus,
		postTitle,
	} );
	stateRef.current = {
		isDirty,
		isSaveable,
		isSaving,
		savePost,
		editPost,
		postStatus,
		postTitle,
	};

	// Promote draft to private once the user has given the page a real title,
	// so WP core regenerates post_name from the title on save.
	const maybePromoteStatus = useCallback( () => {
		const {
			editPost: edit,
			postStatus: s,
			postTitle: t,
		} = stateRef.current;
		if ( s === 'draft' && typeof t === 'string' && t.trim() !== '' ) {
			edit( { status: 'private' } );
		}
	}, [] );

	const saveCurrentPost = useCallback( () => {
		const { savePost: save } = stateRef.current;

		maybePromoteStatus();
		lastSaveAtRef.current = Date.now();
		const savePromise = Promise.resolve( save() ).then(
			() => true,
			() => false
		);
		savePromiseRef.current = savePromise;
		savePromise.finally( () => {
			if ( savePromiseRef.current === savePromise ) {
				savePromiseRef.current = null;
			}
		} );

		return savePromise;
	}, [ maybePromoteStatus ] );

	const waitForSavingToFinish = useCallback( () => {
		if ( ! stateRef.current.isSaving ) {
			return Promise.resolve( true );
		}

		return new Promise( ( resolve ) => {
			savingWaitersRef.current.push( resolve );
		} );
	}, [] );

	const flushNow = useCallback( async () => {
		if ( debounceRef.current ) {
			clearTimeout( debounceRef.current );
			debounceRef.current = null;
		}

		if ( savePromiseRef.current ) {
			const didSave = await savePromiseRef.current;
			if ( ! didSave ) {
				return false;
			}
		}

		if ( stateRef.current.isSaving ) {
			const didSave = await waitForSavingToFinish();
			if ( ! didSave ) {
				return false;
			}
		}

		const {
			isDirty: d,
			isSaveable: s,
			isSaving: saving,
			postStatus: ps,
		} = stateRef.current;
		if ( ! d || ! s || ps === 'trash' ) {
			return true;
		}
		if ( saving ) {
			return waitForSavingToFinish();
		}
		return saveCurrentPost();
	}, [ saveCurrentPost, waitForSavingToFinish ] );

	useEffect( () => {
		if ( isSaving || savingWaitersRef.current.length === 0 ) {
			return;
		}

		const waiters = savingWaitersRef.current;
		savingWaitersRef.current = [];
		waiters.forEach( ( resolve ) => resolve( ! didFail ) );
	}, [ didFail, isSaving ] );

	useEffect( () => {
		if ( ! isDirty || ! isSaveable ) {
			return undefined;
		}
		// Trashed pages are read-only in the canvas; never autosave them.
		// The UI is locked via `<Disabled>`, but a stray edit through any
		// other path (drag-drop, programmatic) shouldn't persist either.
		if ( postStatus === 'trash' ) {
			return undefined;
		}
		const elapsed = Date.now() - lastSaveAtRef.current;
		const wait = Math.max( debounceMs, minSaveIntervalMs - elapsed );

		if ( debounceRef.current ) {
			clearTimeout( debounceRef.current );
		}
		debounceRef.current = setTimeout( () => {
			debounceRef.current = null;
			const {
				isDirty: d,
				isSaveable: s,
				isSaving: saving,
				postStatus: ps,
			} = stateRef.current;
			if ( d && s && ! saving && ps !== 'trash' ) {
				saveCurrentPost();
			}
		}, wait );

		return () => {
			if ( debounceRef.current ) {
				clearTimeout( debounceRef.current );
				debounceRef.current = null;
			}
		};
	}, [
		debounceMs,
		editsReference,
		isDirty,
		isSaveable,
		isSaving,
		minSaveIntervalMs,
		postStatus,
		saveCurrentPost,
	] );

	useEffect( () => {
		// The editor store keeps didSucceed/didFail as level signals, but
		// the user-visible side effects below (status flip, Recents touch)
		// are edges: they should fire once per save that *this hook ran*.
		// Re-running the effect because recentTarget changed (the user opened
		// a different row) must not re-fire success against a stale flag.
		const wasSaving = prevIsSavingRef.current;
		prevIsSavingRef.current = isSaving;

		if ( isSaving ) {
			setStatus( 'saving' );
		} else if ( didFail ) {
			setStatus( 'error' );
			// The toolbar no longer carries a save status, so a failed
			// autosave needs its own way of reaching the user. Snackbar
			// is dismissable and stays out of the way when things work.
			createErrorNotice( __( 'Failed to save changes.', 'cortext' ), {
				id: AUTOSAVE_ERROR_NOTICE_ID,
				type: 'snackbar',
			} );
		} else if ( didSucceed && wasSaving ) {
			setStatus( 'saved' );
			setLastSavedAt( Date.now() );
			removeNotice( AUTOSAVE_ERROR_NOTICE_ID );
			if ( recentKind && recentId ) {
				const target = { kind: recentKind, id: recentId };
				if ( recentCollectionId ) {
					target.collectionId = recentCollectionId;
				}
				touchRecent( target );
			}
		}
	}, [
		isSaving,
		didSucceed,
		didFail,
		createErrorNotice,
		removeNotice,
		recentKind,
		recentId,
		recentCollectionId,
		touchRecent,
	] );

	// CanvasEditor stays mounted across post switches so the iframe survives,
	// which means our local status would otherwise carry a stale "Failed to
	// save" or "Saved" label into the next post. Skip the initial mount; the
	// status flags from the editor store are already authoritative there.
	const lastPostIdRef = useRef( currentPostId );
	useEffect( () => {
		if ( lastPostIdRef.current === currentPostId ) {
			return;
		}
		lastPostIdRef.current = currentPostId;
		setStatus( 'idle' );
		setLastSavedAt( null );
	}, [ currentPostId ] );

	useEffect( () => {
		const onVisibilityChange = () => {
			if ( document.visibilityState === 'hidden' ) {
				flushNow();
			}
		};
		const onBlur = () => {
			flushNow();
		};
		const onBeforeUnload = () => {
			flushNow();
		};

		document.addEventListener( 'visibilitychange', onVisibilityChange );
		window.addEventListener( 'blur', onBlur );
		window.addEventListener( 'beforeunload', onBeforeUnload );

		return () => {
			document.removeEventListener(
				'visibilitychange',
				onVisibilityChange
			);
			window.removeEventListener( 'blur', onBlur );
			window.removeEventListener( 'beforeunload', onBeforeUnload );
			flushNow();
		};
	}, [ flushNow ] );

	return { status, lastSavedAt, flushNow, isDirty, isSaving };
}
