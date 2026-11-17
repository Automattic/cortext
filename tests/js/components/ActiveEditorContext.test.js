import { act, renderHook } from '@testing-library/react';

import {
	ActiveEditorProvider,
	useActiveEditor,
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
} );
