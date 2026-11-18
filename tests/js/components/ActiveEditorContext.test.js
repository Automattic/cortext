import { act, renderHook } from '@testing-library/react';

const mockGetEntityRecord = jest.fn( async () => ( {} ) );
jest.mock( '@wordpress/data', () => ( {
	resolveSelect: () => ( { getEntityRecord: mockGetEntityRecord } ),
} ) );

import {
	ActiveEditorProvider,
	useActiveEditor,
	useEditorsLocked,
} from '../../../src/components/ActiveEditorContext';

function wrapper( { children } ) {
	return <ActiveEditorProvider>{ children }</ActiveEditorProvider>;
}

describe( 'ActiveEditorProvider', () => {
	it( 'flushes the registered canvas and peek editors', async () => {
		const flushCanvas = jest.fn().mockResolvedValue( true );
		const flushPeek = jest.fn().mockResolvedValue( true );
		const { result } = renderHook( () => useActiveEditor(), { wrapper } );

		act( () => {
			result.current.registerActiveEditor( { flushNow: flushCanvas } );
			result.current.registerPeekEditor( { flushNow: flushPeek } );
		} );

		await expect( result.current.flushActiveEditor() ).resolves.toBe(
			true
		);
		expect( flushCanvas ).toHaveBeenCalledTimes( 1 );
		expect( flushPeek ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'reports a failed editor flush and clears an unmounted editor', async () => {
		const flushNow = jest.fn().mockResolvedValue( false );
		const { result } = renderHook( () => useActiveEditor(), { wrapper } );

		act( () => {
			result.current.registerActiveEditor( { flushNow } );
		} );
		await expect( result.current.flushActiveEditor() ).resolves.toBe(
			false
		);

		act( () => result.current.registerActiveEditor( null ) );
		await expect( result.current.flushActiveEditor() ).resolves.toBe(
			true
		);
		expect( flushNow ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'waits for registered pending saves and reports their failure', async () => {
		const flushSaves = jest.fn().mockResolvedValue( false );
		const { result } = renderHook( () => useActiveEditor(), { wrapper } );

		let unregister;
		act( () => {
			unregister = result.current.registerPendingSaves( flushSaves );
		} );
		await expect( result.current.flushActiveEditor() ).resolves.toBe(
			false
		);

		act( () => unregister() );
		await expect( result.current.flushActiveEditor() ).resolves.toBe(
			true
		);
		expect( flushSaves ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'locks the editors until every overlapping lock is released', () => {
		const { result } = renderHook(
			() => ( { api: useActiveEditor(), isLocked: useEditorsLocked() } ),
			{ wrapper }
		);
		const { api } = result.current;
		expect( result.current.isLocked ).toBe( false );

		let unlockFirst;
		let unlockSecond;
		act( () => {
			unlockFirst = api.lockEditors();
			unlockSecond = api.lockEditors();
		} );
		expect( result.current.isLocked ).toBe( true );

		act( () => {
			unlockFirst();
			unlockFirst();
		} );
		expect( result.current.isLocked ).toBe( true );
		// Locking does not hand consumers of the editor API a new value.
		expect( result.current.api ).toBe( api );

		act( () => unlockSecond() );
		expect( result.current.isLocked ).toBe( false );
	} );

	it( 'waits only for the open editors showing one of the given documents', async () => {
		mockGetEntityRecord.mockClear();
		const { result } = renderHook( () => useActiveEditor(), { wrapper } );
		act( () => {
			result.current.registerActiveEditor( {
				postId: 10,
				postType: 'crtxt_document',
			} );
			result.current.registerPeekEditor( {
				postId: 20,
				postType: 'crtxt_document',
			} );
		} );

		await result.current.waitForOpenDocuments( [ '10', 30 ] );

		expect( mockGetEntityRecord ).toHaveBeenCalledTimes( 1 );
		expect( mockGetEntityRecord ).toHaveBeenCalledWith(
			'postType',
			'crtxt_document',
			10
		);
	} );
} );
