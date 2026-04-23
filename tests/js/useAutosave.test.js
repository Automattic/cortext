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

import { useSelect, useDispatch } from '@wordpress/data';
import useAutosave from '../../src/hooks/useAutosave';

const DEFAULT_STATE = {
	isDirty: false,
	isSaveable: true,
	isSaving: false,
	didSucceed: false,
	didFail: false,
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
	useDispatch.mockReturnValue( { savePost: jest.fn() } );
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
		setStoreState( { didSucceed: true } );

		const { result } = renderHook( () => useAutosave() );

		expect( result.current.status ).toBe( 'saved' );
		expect( typeof result.current.lastSavedAt ).toBe( 'number' );
	} );

	it( 'reports error after a failed save', () => {
		setStoreState( { didFail: true } );

		const { result } = renderHook( () => useAutosave() );

		expect( result.current.status ).toBe( 'error' );
	} );
} );
