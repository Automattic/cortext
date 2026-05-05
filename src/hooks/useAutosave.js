import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';
import { store as coreDataStore } from '@wordpress/core-data';
import { store as noticesStore } from '@wordpress/notices';
import { __ } from '@wordpress/i18n';

const DEBOUNCE_MS = 800;
const MIN_SAVE_INTERVAL_MS = 2000;
const AUTOSAVE_ERROR_NOTICE_ID = 'cortext-autosave-error';

export default function useAutosave() {
	const { savePost, editPost } = useDispatch( editorStore );
	const { createErrorNotice, removeNotice } = useDispatch( noticesStore );

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
	const maybePromoteStatus = () => {
		const {
			editPost: edit,
			postStatus: s,
			postTitle: t,
		} = stateRef.current;
		if ( s === 'draft' && typeof t === 'string' && t.trim() !== '' ) {
			edit( { status: 'private' } );
		}
	};

	const flushNow = useCallback( () => {
		if ( debounceRef.current ) {
			clearTimeout( debounceRef.current );
			debounceRef.current = null;
		}
		const {
			isDirty: d,
			isSaveable: s,
			isSaving: saving,
			postStatus: ps,
			savePost: save,
		} = stateRef.current;
		if ( ! d || ! s || ps === 'trash' ) {
			return Promise.resolve( true );
		}
		if ( saving ) {
			return Promise.resolve( false );
		}
		maybePromoteStatus();
		lastSaveAtRef.current = Date.now();
		return Promise.resolve( save() ).then(
			() => true,
			() => false
		);
	}, [] );

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
		const wait = Math.max( DEBOUNCE_MS, MIN_SAVE_INTERVAL_MS - elapsed );

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
				savePost: save,
			} = stateRef.current;
			if ( d && s && ! saving && ps !== 'trash' ) {
				maybePromoteStatus();
				lastSaveAtRef.current = Date.now();
				save();
			}
		}, wait );

		return () => {
			if ( debounceRef.current ) {
				clearTimeout( debounceRef.current );
				debounceRef.current = null;
			}
		};
	}, [ isDirty, isSaveable, editsReference, postStatus ] );

	useEffect( () => {
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
		} else if ( didSucceed ) {
			setStatus( 'saved' );
			setLastSavedAt( Date.now() );
			removeNotice( AUTOSAVE_ERROR_NOTICE_ID );
		}
	}, [ isSaving, didSucceed, didFail, createErrorNotice, removeNotice ] );

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
