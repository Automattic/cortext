import { act, renderHook, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: jest.fn(),
	useSelect: jest.fn(),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	store: { name: 'core/editor' },
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	store: { name: 'core' },
} ) );

let mockHeartbeatActions;
jest.mock( '@wordpress/hooks', () => ( {
	addAction: jest.fn( ( hookName, namespace, callback ) => {
		if ( ! mockHeartbeatActions[ hookName ] ) {
			mockHeartbeatActions[ hookName ] = {};
		}
		mockHeartbeatActions[ hookName ][ namespace ] = callback;
	} ),
	removeAction: jest.fn( ( hookName, namespace ) => {
		delete mockHeartbeatActions[ hookName ]?.[ namespace ];
	} ),
} ) );

import apiFetch from '@wordpress/api-fetch';
import { useDispatch, useSelect } from '@wordpress/data';
import usePostLock from '../../../src/hooks/usePostLock';

const postLockUtils = {
	ajaxUrl: 'https://example.test/wp-admin/admin-ajax.php',
	nonce: 'lock-nonce',
	unlockNonce: 'unlock-nonce',
};

let editorState;
let mockAutosave;
let mockClearEntityRecordEdits;
let mockReceiveEntityRecords;
let mockUpdatePostLock;

function installDataMocks() {
	useDispatch.mockImplementation( ( store ) => {
		if ( store.name === 'core/editor' ) {
			return {
				autosave: mockAutosave,
				updatePostLock: mockUpdatePostLock,
			};
		}

		return {
			clearEntityRecordEdits: mockClearEntityRecordEdits,
			receiveEntityRecords: mockReceiveEntityRecords,
		};
	} );

	useSelect.mockImplementation( ( mapSelect ) =>
		mapSelect( ( store ) => {
			if ( store.name === 'core/editor' ) {
				return {
					getActivePostLock: () => editorState.activePostLock,
					getEditorSettings: () => ( {
						postLockUtils: editorState.postLockUtils,
					} ),
					getPostLockUser: () => editorState.user,
					isPostLocked: () => editorState.isLocked,
					isPostLockTakeover: () => editorState.isTakeover,
				};
			}

			return {};
		} )
	);
}

function receivePostLock( lock ) {
	editorState = {
		...editorState,
		activePostLock: lock.activePostLock ?? null,
		isLocked: !! lock.isLocked,
		isTakeover: !! lock.isTakeover,
		user: lock.user ?? null,
	};
}

function heartbeatCallback( hookName ) {
	return Object.values( mockHeartbeatActions[ hookName ] ?? {} )[ 0 ];
}

beforeEach( () => {
	mockHeartbeatActions = {};
	editorState = {
		activePostLock: null,
		isLocked: false,
		isTakeover: false,
		postLockUtils,
		user: null,
	};
	mockAutosave = jest.fn();
	mockClearEntityRecordEdits = jest.fn();
	mockReceiveEntityRecords = jest.fn();
	mockUpdatePostLock = jest.fn( receivePostLock );
	apiFetch.mockReset();
	installDataMocks();
	globalThis.cortextEditorSettings = { postLockUtils };
	Object.defineProperty( window.navigator, 'sendBeacon', {
		configurable: true,
		value: jest.fn(),
	} );
} );

afterEach( () => {
	delete globalThis.cortextEditorSettings;
	jest.clearAllMocks();
} );

it( 'locks the document on mount', async () => {
	apiFetch.mockResolvedValue( {
		postLock: { isLocked: false, activePostLock: '100:1' },
		postLockUtils,
	} );

	const { result } = renderHook( () =>
		usePostLock( { postId: 7, postType: 'crtxt_document' } )
	);

	expect( result.current.isReadOnly ).toBe( true );

	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: false,
			activePostLock: '100:1',
		} )
	);
	expect( apiFetch ).toHaveBeenCalledWith( {
		path: '/cortext/v1/documents/7/lock',
		method: 'POST',
		data: {},
	} );
} );

it( 'keeps the document read-only when someone else has the lock', async () => {
	apiFetch.mockResolvedValue( {
		postLock: {
			isLocked: true,
			user: { name: 'Current Editor', avatar: 'avatar.png' },
		},
		postLockUtils,
	} );

	const { result, rerender } = renderHook( () =>
		usePostLock( { postId: 7, postType: 'crtxt_document' } )
	);

	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: true,
			user: { name: 'Current Editor', avatar: 'avatar.png' },
		} )
	);
	rerender();

	expect( result.current.isLocked ).toBe( true );
	expect( result.current.isReadOnly ).toBe( true );
	expect( result.current.user.name ).toBe( 'Current Editor' );
} );

it( 'refreshes our lock through heartbeat', async () => {
	apiFetch.mockResolvedValue( {
		postLock: { isLocked: false, activePostLock: '100:1' },
		postLockUtils,
	} );

	const { rerender } = renderHook( () =>
		usePostLock( { postId: 7, postType: 'crtxt_document' } )
	);

	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: false,
			activePostLock: '100:1',
		} )
	);
	rerender();

	const sent = {};
	act( () => heartbeatCallback( 'heartbeat.send' )( sent ) );
	expect( sent[ 'wp-refresh-post-lock' ] ).toEqual( {
		lock: '100:1',
		post_id: 7,
	} );

	act( () =>
		heartbeatCallback( 'heartbeat.tick' )( {
			'wp-refresh-post-lock': { new_lock: '110:1' },
		} )
	);
	expect( mockUpdatePostLock ).toHaveBeenLastCalledWith( {
		isLocked: false,
		activePostLock: '110:1',
	} );
} );

it( 'becomes read-only when heartbeat says someone took over', async () => {
	apiFetch.mockResolvedValue( {
		postLock: { isLocked: false, activePostLock: '100:1' },
		postLockUtils,
	} );

	renderHook( () =>
		usePostLock( { postId: 7, postType: 'crtxt_document' } )
	);

	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: false,
			activePostLock: '100:1',
		} )
	);

	act( () =>
		heartbeatCallback( 'heartbeat.tick' )( {
			'wp-refresh-post-lock': {
				lock_error: {
					name: 'Second Editor',
					avatar_src_2x: 'second.png',
				},
			},
		} )
	);

	expect( mockAutosave ).toHaveBeenCalledTimes( 1 );
	expect( mockUpdatePostLock ).toHaveBeenLastCalledWith( {
		isLocked: true,
		isTakeover: true,
		user: { name: 'Second Editor', avatar: 'second.png' },
	} );
} );

it( 'releases its lock on unmount', async () => {
	const sendBeacon = jest.fn();
	Object.defineProperty( window.navigator, 'sendBeacon', {
		configurable: true,
		value: sendBeacon,
	} );
	apiFetch.mockResolvedValue( {
		postLock: { isLocked: false, activePostLock: '100:1' },
		postLockUtils,
	} );

	const { rerender, unmount } = renderHook( () =>
		usePostLock( { postId: 7, postType: 'crtxt_document' } )
	);

	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: false,
			activePostLock: '100:1',
		} )
	);
	rerender();
	unmount();

	expect( sendBeacon ).toHaveBeenCalledTimes( 1 );
	const [ url, body ] = sendBeacon.mock.calls[ 0 ];
	expect( url ).toBe( postLockUtils.ajaxUrl );
	expect( body.get( 'action' ) ).toBe( 'wp-remove-post-lock' );
	expect( body.get( 'post_ID' ) ).toBe( '7' );
	expect( body.get( 'active_post_lock' ) ).toBe( '100:1' );
} );

it( "releases the previous document's lock when navigating", async () => {
	const sendBeacon = jest.fn();
	Object.defineProperty( window.navigator, 'sendBeacon', {
		configurable: true,
		value: sendBeacon,
	} );
	apiFetch
		.mockResolvedValueOnce( {
			postLock: { isLocked: false, activePostLock: '100:1' },
			postLockUtils,
		} )
		.mockResolvedValueOnce( {
			postLock: { isLocked: false, activePostLock: '200:1' },
			postLockUtils,
		} );

	const { rerender } = renderHook(
		( { postId } ) => usePostLock( { postId, postType: 'crtxt_document' } ),
		{ initialProps: { postId: 7 } }
	);

	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: false,
			activePostLock: '100:1',
		} )
	);

	await act( async () => {
		rerender( { postId: 8 } );
	} );

	expect( sendBeacon ).toHaveBeenCalledTimes( 1 );
	const [ url, body ] = sendBeacon.mock.calls[ 0 ];
	expect( url ).toBe( postLockUtils.ajaxUrl );
	expect( body.get( 'action' ) ).toBe( 'wp-remove-post-lock' );
	expect( body.get( 'post_ID' ) ).toBe( '7' );
	expect( body.get( 'active_post_lock' ) ).toBe( '100:1' );
	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: false,
			activePostLock: '200:1',
		} )
	);
} );

it( 'keeps the document read-only when the lock check fails', async () => {
	apiFetch.mockRejectedValue( new Error( 'No connection' ) );

	const { result } = renderHook( () =>
		usePostLock( { postId: 7, postType: 'crtxt_document' } )
	);

	await waitFor( () =>
		expect( result.current.error ).toBe( 'No connection' )
	);
	expect( result.current.isReadOnly ).toBe( true );
} );

it( 'takes over in-app and reloads the fresh post', async () => {
	apiFetch
		.mockResolvedValueOnce( {
			postLock: {
				isLocked: true,
				user: { name: 'Current Editor' },
			},
			postLockUtils,
		} )
		.mockResolvedValueOnce( {
			post: { id: 7, type: 'crtxt_document', title: { raw: 'Fresh' } },
			postLock: { isLocked: false, activePostLock: '120:2' },
			postLockUtils,
		} );

	const { result } = renderHook( () =>
		usePostLock( { postId: 7, postType: 'crtxt_document' } )
	);

	await waitFor( () =>
		expect( mockUpdatePostLock ).toHaveBeenCalledWith( {
			isLocked: true,
			user: { name: 'Current Editor' },
		} )
	);

	await act( async () => {
		await result.current.takeOver();
	} );

	expect( apiFetch ).toHaveBeenLastCalledWith( {
		path: '/cortext/v1/documents/7/lock',
		method: 'POST',
		data: { force: true },
	} );
	expect( mockReceiveEntityRecords ).toHaveBeenCalledWith(
		'postType',
		'crtxt_document',
		[ { id: 7, type: 'crtxt_document', title: { raw: 'Fresh' } } ],
		undefined,
		true
	);
	expect( mockClearEntityRecordEdits ).toHaveBeenCalledWith(
		'postType',
		'crtxt_document',
		7
	);
	expect(
		mockClearEntityRecordEdits.mock.invocationCallOrder[ 0 ]
	).toBeLessThan( mockReceiveEntityRecords.mock.invocationCallOrder[ 0 ] );
	expect( mockUpdatePostLock ).toHaveBeenLastCalledWith( {
		isLocked: false,
		activePostLock: '120:2',
	} );
} );
