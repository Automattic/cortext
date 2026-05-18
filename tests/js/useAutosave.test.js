/**
 * Tests for `src/hooks/useAutosave.js`: debounce + throttle cadence, the
 * idle/saving/saved/error state machine, and flush triggers (window blur,
 * visibilitychange, beforeunload, unmount). `@wordpress/data` and the editor
 * store are mocked so each test controls what the hook reads from the store.
 */

import { act, renderHook } from '@testing-library/react';

jest.mock( '@wordpress/data', () => ( {
	useSelect: jest.fn(),
	useDispatch: jest.fn(),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	store: { name: 'core/editor' },
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: { name: 'core' },
} ) );

jest.mock( '@wordpress/notices', () => ( {
	store: { name: 'core/notices' },
} ) );

const mockTouchRecent = jest.fn();
jest.mock( '../../src/hooks/useRecents', () => ( {
	useRecents: () => ( { touchRecent: mockTouchRecent } ),
} ) );

import { useSelect, useDispatch } from '@wordpress/data';
import useAutosave from '../../src/hooks/useAutosave';

const DEFAULT_STATE = {
	isDirty: false,
	isSaveable: true,
	isSaving: false,
	didSucceed: false,
	didFail: false,
	postStatus: 'private',
	postTitle: '',
	currentPostId: 1,
};

let editsReference = {};

function setStoreState( state ) {
	const merged = { ...DEFAULT_STATE, ...state };
	const editorSelectors = {
		isEditedPostDirty: () => merged.isDirty,
		isEditedPostSaveable: () => merged.isSaveable,
		isSavingPost: () => merged.isSaving,
		didPostSaveRequestSucceed: () => merged.didSucceed,
		didPostSaveRequestFail: () => merged.didFail,
		getCurrentPostId: () => merged.currentPostId,
		getEditedPostAttribute: ( name ) => {
			if ( name === 'status' ) {
				return merged.postStatus;
			}
			if ( name === 'title' ) {
				return merged.postTitle;
			}
			return undefined;
		},
	};
	const coreDataSelectors = {
		getReferenceByDistinctEdits: () => editsReference,
	};
	useSelect.mockImplementation( ( mapSelect ) =>
		mapSelect( ( storeName ) => {
			if ( storeName.name === 'core/editor' ) {
				return editorSelectors;
			}
			if ( storeName.name === 'core' ) {
				return coreDataSelectors;
			}
			return {};
		} )
	);
}

function simulateEdit() {
	editsReference = {};
}

beforeEach( () => {
	jest.useFakeTimers();
	editsReference = {};
	setStoreState( {} );
	useDispatch.mockReturnValue( {
		savePost: jest.fn(),
		editPost: jest.fn(),
		createErrorNotice: jest.fn(),
		removeNotice: jest.fn(),
	} );
	mockTouchRecent.mockReset();
} );

afterEach( () => {
	jest.clearAllTimers();
	jest.useRealTimers();
	jest.clearAllMocks();
} );

describe( 'useAutosave: debounce', () => {
	it( 'does not save until DEBOUNCE_MS has elapsed after dirty', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 799 );
		} );
		expect( savePost ).not.toHaveBeenCalled();

		act( () => {
			jest.advanceTimersByTime( 1 );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'resets the debounce timer on every edit during continuous typing', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		const { rerender } = renderHook( () => useAutosave() );

		// Simulate continuous typing: every 200ms a new edit lands,
		// each should reset the 800ms debounce timer.
		for ( let i = 0; i < 10; i++ ) {
			act( () => {
				jest.advanceTimersByTime( 200 );
			} );
			simulateEdit();
			setStoreState( { isDirty: true } );
			rerender();
		}

		// 2000ms of typing elapsed, but no save should have fired.
		expect( savePost ).not.toHaveBeenCalled();

		// Now stop typing. After 800ms the debounce fires.
		act( () => {
			jest.advanceTimersByTime( 800 );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'skips save when not dirty', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: false } );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 5000 );
		} );
		expect( savePost ).not.toHaveBeenCalled();
	} );

	it( 'skips save when not saveable', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true, isSaveable: false } );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 5000 );
		} );
		expect( savePost ).not.toHaveBeenCalled();
	} );

	it( 'skips save while a save is already in flight', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true, isSaving: true } );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 5000 );
		} );
		expect( savePost ).not.toHaveBeenCalled();
	} );
} );

describe( 'useAutosave: throttle', () => {
	it( 'waits for the remainder of MIN_SAVE_INTERVAL after a recent save', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		const { rerender } = renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 800 );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );

		// Clean state, then dirty again 400ms later; throttle should delay
		// the next save to 2000 - 400 = 1600ms from the first save.
		setStoreState( { isDirty: false } );
		rerender();
		act( () => {
			jest.advanceTimersByTime( 400 );
		} );
		setStoreState( { isDirty: true } );
		rerender();

		act( () => {
			jest.advanceTimersByTime( 1599 );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );

		act( () => {
			jest.advanceTimersByTime( 1 );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 2 );
	} );
} );

describe( 'useAutosave: flush triggers', () => {
	it( 'flushes immediately on window blur', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		renderHook( () => useAutosave() );

		act( () => {
			window.dispatchEvent( new Event( 'blur' ) );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'flushes when document becomes hidden', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		renderHook( () => useAutosave() );

		Object.defineProperty( document, 'visibilityState', {
			configurable: true,
			get: () => 'hidden',
		} );

		try {
			act( () => {
				document.dispatchEvent( new Event( 'visibilitychange' ) );
			} );
			expect( savePost ).toHaveBeenCalledTimes( 1 );
		} finally {
			// Remove the instance-level override so the prototype's
			// default 'visible' getter takes over again.
			delete document.visibilityState;
		}
	} );

	it( 'does not flush on visibilitychange when document is visible', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		renderHook( () => useAutosave() );

		// jsdom's default visibilityState is 'visible'.
		act( () => {
			document.dispatchEvent( new Event( 'visibilitychange' ) );
		} );
		expect( savePost ).not.toHaveBeenCalled();
	} );

	it( 'flushes on unmount', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		const { unmount } = renderHook( () => useAutosave() );

		unmount();
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not flush on blur when not dirty', () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: false } );

		renderHook( () => useAutosave() );

		act( () => {
			window.dispatchEvent( new Event( 'blur' ) );
		} );
		expect( savePost ).not.toHaveBeenCalled();
	} );

	it( 'waits for an in-flight autosave instead of reporting failure', async () => {
		let resolveSave;
		const savePost = jest.fn(
			() =>
				new Promise( ( resolve ) => {
					resolveSave = resolve;
				} )
		);
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		const { result, rerender } = renderHook( () =>
			useAutosave( { debounceMs: 0, minSaveIntervalMs: 0 } )
		);

		act( () => {
			jest.advanceTimersByTime( 0 );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );

		const flushPromise = result.current.flushNow();
		act( () => {
			setStoreState( { isDirty: false } );
			rerender();
		} );

		await act( async () => {
			resolveSave();
			await expect( flushPromise ).resolves.toBe( true );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'flushes edits made while an autosave is in flight', async () => {
		let resolveFirstSave;
		const savePost = jest
			.fn()
			.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						resolveFirstSave = resolve;
					} )
			)
			.mockResolvedValueOnce();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true } );

		const { result, rerender } = renderHook( () =>
			useAutosave( { debounceMs: 0, minSaveIntervalMs: 0 } )
		);

		act( () => {
			jest.advanceTimersByTime( 0 );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 1 );

		const flushPromise = result.current.flushNow();
		act( () => {
			setStoreState( { isDirty: true, isSaving: false } );
			rerender();
		} );

		await act( async () => {
			resolveFirstSave();
			await expect( flushPromise ).resolves.toBe( true );
		} );
		expect( savePost ).toHaveBeenCalledTimes( 2 );
	} );

	it( 'waits for a store-reported save before flushing remaining edits', async () => {
		const savePost = jest.fn();
		useDispatch.mockReturnValue( { savePost } );
		setStoreState( { isDirty: true, isSaving: true } );

		const { result, rerender } = renderHook( () =>
			useAutosave( { debounceMs: 0, minSaveIntervalMs: 0 } )
		);

		let didResolve = false;
		const flushPromise = result.current.flushNow().then( ( value ) => {
			didResolve = true;
			return value;
		} );

		await act( async () => {
			await Promise.resolve();
		} );
		expect( didResolve ).toBe( false );
		expect( savePost ).not.toHaveBeenCalled();

		act( () => {
			setStoreState( { isDirty: true, isSaving: false } );
			rerender();
		} );

		await expect( flushPromise ).resolves.toBe( true );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );
} );

describe( 'useAutosave: status', () => {
	it( 'starts idle', () => {
		const { result } = renderHook( () => useAutosave() );

		expect( result.current.status ).toBe( 'idle' );
		expect( result.current.lastSavedAt ).toBeNull();
	} );

	it( 'reports saving while a save is in flight', () => {
		setStoreState( { isSaving: true } );

		const { result } = renderHook( () => useAutosave() );

		expect( result.current.status ).toBe( 'saving' );
	} );

	it( 'reports saved and captures lastSavedAt after a successful save', () => {
		setStoreState( { isSaving: true, currentPostId: 42 } );

		const { result, rerender } = renderHook( () => useAutosave() );

		act( () => {
			setStoreState( {
				isSaving: false,
				didSucceed: true,
				currentPostId: 42,
			} );
			rerender();
		} );

		expect( result.current.status ).toBe( 'saved' );
		expect( typeof result.current.lastSavedAt ).toBe( 'number' );
		expect( mockTouchRecent ).not.toHaveBeenCalled();
	} );

	it( 'touches the configured page recent after a successful save', () => {
		setStoreState( { isSaving: false, currentPostId: 42 } );

		const { rerender } = renderHook( () =>
			useAutosave( {
				recentTarget: { kind: 'page', id: 42 },
			} )
		);

		act( () => {
			setStoreState( { isSaving: true, currentPostId: 42 } );
			rerender();
		} );
		act( () => {
			setStoreState( {
				isSaving: false,
				didSucceed: true,
				currentPostId: 42,
			} );
			rerender();
		} );

		expect( mockTouchRecent ).toHaveBeenCalledWith( {
			kind: 'page',
			id: 42,
		} );
	} );

	it( 'touches the configured row recent after a successful save', () => {
		setStoreState( { isSaving: false, currentPostId: 42 } );

		const { rerender } = renderHook( () =>
			useAutosave( {
				recentTarget: { kind: 'row', id: 42, collectionId: 9 },
			} )
		);

		act( () => {
			setStoreState( { isSaving: true, currentPostId: 42 } );
			rerender();
		} );
		act( () => {
			setStoreState( {
				isSaving: false,
				didSucceed: true,
				currentPostId: 42,
			} );
			rerender();
		} );

		expect( mockTouchRecent ).toHaveBeenCalledWith( {
			kind: 'row',
			id: 42,
			collectionId: 9,
		} );
	} );

	it( 'does not touch recent when mounted with a stale didSucceed flag', () => {
		// Simulates opening a different row while the editor store still
		// reports the previous post's save as successful. Without a real
		// isSaving transition observed by this hook, the success belongs to
		// someone else and must not enter Recents.
		setStoreState( {
			isSaving: false,
			didSucceed: true,
			currentPostId: 42,
		} );

		renderHook( () =>
			useAutosave( {
				recentTarget: { kind: 'row', id: 42, collectionId: 9 },
			} )
		);

		expect( mockTouchRecent ).not.toHaveBeenCalled();
	} );

	it( 'touches the recent target latched at save start, not the one swapped in mid-flight', () => {
		// Edit row A → save starts → user opens row B before the save
		// resolves. When the save lands, Recents must reflect A (which was
		// actually saved), not B (which the parent has since swapped in).
		const targetA = { kind: 'row', id: 1, collectionId: 9 };
		const targetB = { kind: 'row', id: 2, collectionId: 9 };

		setStoreState( { isSaving: false, currentPostId: 1 } );

		const { rerender } = renderHook( ( props ) => useAutosave( props ), {
			initialProps: { recentTarget: targetA },
		} );

		act( () => {
			setStoreState( { isSaving: true, currentPostId: 1 } );
			rerender( { recentTarget: targetA } );
		} );

		// Parent swaps in row B while the save for A is still in flight.
		act( () => {
			setStoreState( { isSaving: true, currentPostId: 1 } );
			rerender( { recentTarget: targetB } );
		} );

		// Save for A resolves.
		act( () => {
			setStoreState( {
				isSaving: false,
				didSucceed: true,
				currentPostId: 1,
			} );
			rerender( { recentTarget: targetB } );
		} );

		expect( mockTouchRecent ).toHaveBeenCalledTimes( 1 );
		expect( mockTouchRecent ).toHaveBeenCalledWith( targetA );
	} );

	it( 'does not touch recent when recentTarget changes without an intervening save', () => {
		setStoreState( {
			isSaving: false,
			didSucceed: true,
			currentPostId: 42,
		} );

		const { rerender } = renderHook( ( props ) => useAutosave( props ), {
			initialProps: {
				recentTarget: { kind: 'row', id: 1, collectionId: 9 },
			},
		} );

		act( () => {
			rerender( {
				recentTarget: { kind: 'row', id: 2, collectionId: 9 },
			} );
		} );

		expect( mockTouchRecent ).not.toHaveBeenCalled();
	} );

	it( 'reports error after a failed save', () => {
		setStoreState( { didFail: true } );

		const { result } = renderHook( () => useAutosave() );

		expect( result.current.status ).toBe( 'error' );
	} );

	it( 'surfaces a snackbar notice when a save fails', () => {
		const createErrorNotice = jest.fn();
		useDispatch.mockReturnValue( {
			savePost: jest.fn(),
			editPost: jest.fn(),
			createErrorNotice,
			removeNotice: jest.fn(),
		} );
		setStoreState( { didFail: true } );

		renderHook( () => useAutosave() );

		expect( createErrorNotice ).toHaveBeenCalledWith(
			expect.any( String ),
			expect.objectContaining( {
				type: 'snackbar',
				id: 'cortext-autosave-error',
			} )
		);
	} );

	it( 'removes the autosave error notice after a successful save', () => {
		const removeNotice = jest.fn();
		useDispatch.mockReturnValue( {
			savePost: jest.fn(),
			editPost: jest.fn(),
			createErrorNotice: jest.fn(),
			removeNotice,
		} );
		setStoreState( { didFail: true } );

		const { rerender } = renderHook( () => useAutosave() );

		act( () => {
			setStoreState( { isSaving: true, didFail: false } );
			rerender();
		} );
		act( () => {
			setStoreState( { isSaving: false, didSucceed: true } );
			rerender();
		} );

		expect( removeNotice ).toHaveBeenCalledWith( 'cortext-autosave-error' );
	} );

	it( 'resets status when the current post id changes', () => {
		setStoreState( { didFail: true, currentPostId: 1 } );

		const { result, rerender } = renderHook( () => useAutosave() );
		expect( result.current.status ).toBe( 'error' );

		act( () => {
			setStoreState( { didFail: false, currentPostId: 2 } );
			rerender();
		} );

		expect( result.current.status ).toBe( 'idle' );
		expect( result.current.lastSavedAt ).toBeNull();
	} );
} );

describe( 'useAutosave: auto-draft promotion', () => {
	it( 'promotes auto-draft to private before saving when title is non-empty', () => {
		const savePost = jest.fn();
		const editPost = jest.fn();
		useDispatch.mockReturnValue( { savePost, editPost } );
		setStoreState( {
			isDirty: true,
			postStatus: 'draft',
			postTitle: 'About Us',
		} );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 800 );
		} );

		expect( editPost ).toHaveBeenCalledWith( { status: 'private' } );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not promote when title is empty', () => {
		const savePost = jest.fn();
		const editPost = jest.fn();
		useDispatch.mockReturnValue( { savePost, editPost } );
		setStoreState( {
			isDirty: true,
			postStatus: 'draft',
			postTitle: '',
		} );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 800 );
		} );

		expect( editPost ).not.toHaveBeenCalled();
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not promote when title is whitespace only', () => {
		const savePost = jest.fn();
		const editPost = jest.fn();
		useDispatch.mockReturnValue( { savePost, editPost } );
		setStoreState( {
			isDirty: true,
			postStatus: 'draft',
			postTitle: '   ',
		} );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 800 );
		} );

		expect( editPost ).not.toHaveBeenCalled();
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'does not promote when status is already private', () => {
		const savePost = jest.fn();
		const editPost = jest.fn();
		useDispatch.mockReturnValue( { savePost, editPost } );
		setStoreState( {
			isDirty: true,
			postStatus: 'private',
			postTitle: 'About Us',
		} );

		renderHook( () => useAutosave() );

		act( () => {
			jest.advanceTimersByTime( 800 );
		} );

		expect( editPost ).not.toHaveBeenCalled();
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'promotes on flush triggers (blur)', () => {
		const savePost = jest.fn();
		const editPost = jest.fn();
		useDispatch.mockReturnValue( { savePost, editPost } );
		setStoreState( {
			isDirty: true,
			postStatus: 'draft',
			postTitle: 'Team',
		} );

		renderHook( () => useAutosave() );

		act( () => {
			window.dispatchEvent( new Event( 'blur' ) );
		} );

		expect( editPost ).toHaveBeenCalledWith( { status: 'private' } );
		expect( savePost ).toHaveBeenCalledTimes( 1 );
	} );
} );
