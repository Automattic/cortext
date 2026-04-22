import { useEffect, useRef, useState } from '@wordpress/element';
import { useSelect, useDispatch } from '@wordpress/data';
import { store as editorStore } from '@wordpress/editor';

const DEBOUNCE_MS = 800;
const MIN_SAVE_INTERVAL_MS = 2000;

export default function useAutosave() {
	const { savePost } = useDispatch( editorStore );

	const { isDirty, isSaveable, isSaving, didSucceed, didFail } = useSelect(
		( select ) => {
			const editor = select( editorStore );
			return {
				isDirty: editor.isEditedPostDirty(),
				isSaveable: editor.isEditedPostSaveable(),
				isSaving: editor.isSavingPost(),
				didSucceed: editor.didPostSaveRequestSucceed(),
				didFail: editor.didPostSaveRequestFail(),
			};
		},
		[]
	);

	const [ status, setStatus ] = useState( 'idle' );
	const [ lastSavedAt, setLastSavedAt ] = useState( null );

	const debounceRef = useRef( null );
	const lastSaveAtRef = useRef( 0 );

	const stateRef = useRef( { isDirty, isSaveable, isSaving, savePost } );
	stateRef.current = { isDirty, isSaveable, isSaving, savePost };

	const flushNow = () => {
		if ( debounceRef.current ) {
			clearTimeout( debounceRef.current );
			debounceRef.current = null;
		}
		const {
			isDirty: d,
			isSaveable: s,
			isSaving: saving,
			savePost: save,
		} = stateRef.current;
		if ( d && s && ! saving ) {
			lastSaveAtRef.current = Date.now();
			save();
		}
	};

	useEffect( () => {
		if ( ! isDirty || ! isSaveable ) {
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
				savePost: save,
			} = stateRef.current;
			if ( d && s && ! saving ) {
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
	}, [ isDirty, isSaveable ] );

	useEffect( () => {
		if ( isSaving ) {
			setStatus( 'saving' );
		} else if ( didFail ) {
			setStatus( 'error' );
		} else if ( didSucceed ) {
			setStatus( 'saved' );
			setLastSavedAt( Date.now() );
		}
	}, [ isSaving, didSucceed, didFail ] );

	useEffect( () => {
		const onVisibilityChange = () => {
			if ( document.visibilityState === 'hidden' ) {
				flushNow();
			}
		};
		const onBlur = () => flushNow();
		const onBeforeUnload = () => flushNow();

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
	}, [] );

	return { status, lastSavedAt };
}
