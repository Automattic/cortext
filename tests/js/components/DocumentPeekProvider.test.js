/**
 * Tests for DocumentPeekProvider state: mode stickiness, full navigation,
 * close, and adjacent-row navigation from the source row list.
 *
 * DocumentPeekHost renders the panel/modal. These tests stay on the provider
 * and mock useNavigate so full-mode transitions are visible.
 */

import { act, renderHook } from '@testing-library/react';

const mockNavigate = jest.fn();
jest.mock( '@wordpress/route', () => ( {
	useNavigate: () => mockNavigate,
} ) );

import {
	DocumentPeekProvider,
	useDocumentPeekActions,
	useDocumentPeekState,
	useDocumentPeekSurface,
} from '../../../src/components/DocumentPeekProvider';
import {
	ActiveEditorProvider,
	useActiveEditor,
} from '../../../src/components/ActiveEditorContext';
import { withViewTransition } from '../../../src/hooks/viewTransition';

function wrapper( { children } ) {
	return (
		<ActiveEditorProvider>
			<DocumentPeekProvider>{ children }</DocumentPeekProvider>
		</ActiveEditorProvider>
	);
}

function useBoth() {
	return {
		state: useDocumentPeekState(),
		actions: useDocumentPeekActions(),
	};
}

function useHarness() {
	return {
		state: useDocumentPeekState(),
		actions: useDocumentPeekActions(),
		surface: useDocumentPeekSurface(),
		activeEditor: useActiveEditor(),
	};
}

beforeEach( () => {
	mockNavigate.mockReset();
} );

describe( 'DocumentPeekProvider', () => {
	it( "opens a peek using the caller's mode when none is open", async () => {
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 12,
				slug: 'ada-lovelace',
				postType: 'crtxt_people',
				collectionId: 7,
				preferredMode: 'modal',
			} );
		} );

		expect( result.current.state.peek ).toMatchObject( {
			docId: 12,
			slug: 'ada-lovelace',
			postType: 'crtxt_people',
			collectionId: 7,
			mode: 'modal',
		} );
		expect( mockNavigate ).not.toHaveBeenCalled();
	} );

	it( 'keeps the current peek mode when another caller prefers a different one', async () => {
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 1,
				preferredMode: 'side',
				postType: 'crtxt_a',
				collectionId: 1,
			} );
		} );
		await act( async () => {
			result.current.actions.openDocument( {
				id: 2,
				preferredMode: 'modal',
				postType: 'crtxt_b',
				collectionId: 2,
			} );
		} );

		expect( result.current.state.peek ).toMatchObject( {
			docId: 2,
			mode: 'side',
		} );
	} );

	it( 'navigates to the row URL in full mode and clears the peek', async () => {
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 42,
				slug: 'about',
				preferredMode: 'full',
			} );
		} );

		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'about-42' },
			search: expect.any( Function ),
		} );
		const navigateOptions = mockNavigate.mock.calls[ 0 ][ 0 ];
		expect(
			navigateOptions.search( {
				collection: 99,
				collectionRow: 98,
				filter: 'open',
			} )
		).toEqual( { filter: 'open' } );
		expect( result.current.state.peek ).toBe( null );
	} );

	it( 'falls back to the bare id when no slug is provided', async () => {
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 5,
				preferredMode: 'full',
			} );
		} );

		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: '5' },
			search: expect.any( Function ),
		} );
	} );

	it( 'closes the peek', async () => {
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 1,
				preferredMode: 'side',
				postType: 'crtxt_a',
				collectionId: 1,
			} );
		} );
		await act( async () => {
			result.current.actions.closeDocument();
		} );

		expect( result.current.state.peek ).toBe( null );
	} );

	it( 'walks adjacent rows using the source row list', async () => {
		const rows = [
			{ id: 10, slug: 'first' },
			{ id: 20, slug: 'second' },
			{ id: 30, slug: 'third' },
		];
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 10,
				slug: 'first',
				postType: 'crtxt_a',
				collectionId: 1,
				preferredMode: 'side',
				source: { getRowList: () => rows },
			} );
		} );

		expect( result.current.state.peek?.docId ).toBe( 10 );
	} );

	it( 'keeps the pin while moving to the next row', async () => {
		const rows = [
			{ id: 10, slug: 'first' },
			{ id: 20, slug: 'second' },
		];
		const { result } = renderHook( useHarness, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 10,
				slug: 'first',
				postType: 'crtxt_a',
				collectionId: 1,
				preferredMode: 'side',
				source: { getRowList: () => rows },
			} );
		} );
		act( () => {
			result.current.surface.togglePin();
		} );
		await act( async () => {
			result.current.surface.goToAdjacentDocument( 1 );
		} );

		expect( result.current.state.peek ).toMatchObject( {
			docId: 20,
			slug: 'second',
			mode: 'side',
		} );
		expect( result.current.state.isPinned ).toBe( true );
	} );

	it( 'requestMode keeps the row slug when switching to full mode', async () => {
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 12,
				slug: 'ada-lovelace',
				postType: 'crtxt_people',
				collectionId: 7,
				preferredMode: 'side',
			} );
		} );
		await act( async () => {
			await result.current.actions.requestMode( 'full' );
		} );

		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'ada-lovelace-12' },
			search: expect.any( Function ),
		} );
		const navigateOptions = mockNavigate.mock.calls[ 0 ][ 0 ];
		expect( navigateOptions.search( { filter: 'open' } ) ).toEqual( {
			filter: 'open',
			collection: 7,
			collectionRow: 12,
		} );
	} );

	it( 'saves a pending mode before opening full screen', async () => {
		const onModeChange = jest.fn();
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 12,
				slug: 'ada-lovelace',
				preferredMode: 'side',
				source: { onModeChange },
			} );
		} );
		await act( async () => {
			await result.current.actions.requestMode( 'modal' );
		} );
		// The save waits for the resize to finish.
		expect( onModeChange ).not.toHaveBeenCalled();

		await act( async () => {
			await result.current.actions.requestMode( 'full' );
		} );

		expect( onModeChange ).toHaveBeenCalledWith( 'modal' );
	} );

	it( 'keeps a peek opened full screen up until the route swaps the page in', async () => {
		const { result } = renderHook( useBoth, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 12,
				slug: 'ada-lovelace',
				postType: 'crtxt_people',
				preferredMode: 'modal',
			} );
		} );
		await act( async () => {
			await result.current.actions.requestMode( 'full' );
		} );

		expect( result.current.state.peek ).toMatchObject( {
			docId: 12,
			isExiting: true,
		} );
		expect( document.documentElement.dataset.cortextPeekToFull ).toBe(
			'leaving'
		);

		// The route's swap runs through withViewTransition, which closes the
		// peek in the same update.
		const swapPage = jest.fn();
		act( () => {
			withViewTransition( swapPage );
		} );

		expect( swapPage ).toHaveBeenCalled();
		expect( result.current.state.peek ).toBe( null );
		await act( async () => {} );
		expect(
			document.documentElement.dataset.cortextPeekToFull
		).toBeUndefined();
	} );

	it( 'closes a peek opened full screen when the route never swaps', async () => {
		jest.useFakeTimers();
		try {
			const { result } = renderHook( useBoth, { wrapper } );

			await act( async () => {
				result.current.actions.openDocument( {
					id: 12,
					slug: 'ada-lovelace',
					preferredMode: 'side',
				} );
			} );
			await act( async () => {
				await result.current.actions.requestMode( 'full' );
			} );
			expect( result.current.state.peek ).not.toBe( null );

			await act( async () => {
				jest.advanceTimersByTime( 2000 );
			} );

			expect( result.current.state.peek ).toBe( null );
		} finally {
			jest.useRealTimers();
		}
	} );

	it( 'returns safe no-ops when actions are used outside the provider', () => {
		// CollectionDataViews also mounts inside the block editor preview of a
		// data-view block, which has no peek provider. Calling openDocument
		// there should silently do nothing, not crash the editor.
		const { result } = renderHook( () => useDocumentPeekActions() );
		expect( () => result.current.openDocument( { id: 1 } ) ).not.toThrow();
		expect( () => result.current.closeDocument() ).not.toThrow();
		expect( () => result.current.requestMode( 'side' ) ).not.toThrow();
	} );

	it( 'reads peek=null when state is used outside the provider', () => {
		const { result } = renderHook( () => useDocumentPeekState() );
		expect( result.current.peek ).toBe( null );
	} );

	it( 'refreshes the source after a close that flushed pending edits', async () => {
		const refresh = jest.fn();
		const flushNow = jest.fn().mockResolvedValue( true );
		const hasPendingEdits = jest.fn().mockReturnValue( true );
		const { result } = renderHook(
			() => ( {
				actions: useDocumentPeekActions(),
				surface: useDocumentPeekSurface(),
			} ),
			{ wrapper }
		);

		await act( async () => {
			result.current.actions.openDocument( {
				id: 1,
				postType: 'crtxt_a',
				collectionId: 1,
				preferredMode: 'side',
				source: { getRowList: () => [], refresh },
			} );
		} );
		act( () => {
			result.current.surface.setDetailApi( {
				flushNow,
				discard: jest.fn(),
				hasPendingEdits,
			} );
		} );
		await act( async () => {
			await result.current.actions.closeDocument();
		} );

		expect( flushNow ).toHaveBeenCalled();
		expect( refresh ).toHaveBeenCalled();
	} );

	it( 'registers the open peek for archive preflight flushes', async () => {
		const flushNow = jest.fn().mockResolvedValue( true );
		const { result } = renderHook( useHarness, { wrapper } );

		act( () => {
			result.current.surface.setDetailApi( { flushNow } );
		} );
		await expect(
			result.current.activeEditor.flushActiveEditor()
		).resolves.toBe( true );

		expect( flushNow ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'keeps the peek open when its flush reports a real failure', async () => {
		const flushNow = jest.fn().mockResolvedValue( false );
		const { result } = renderHook( useHarness, { wrapper } );

		await act( async () => {
			result.current.actions.openDocument( {
				id: 1,
				postType: 'crtxt_a',
				collectionId: 1,
				preferredMode: 'side',
			} );
		} );
		act( () => {
			result.current.surface.setDetailApi( {
				flushNow,
				discard: jest.fn(),
				hasPendingEdits: jest.fn().mockReturnValue( true ),
			} );
		} );
		await act( async () => {
			await result.current.actions.closeDocument();
		} );

		expect( result.current.state.peek?.docId ).toBe( 1 );
		expect( result.current.surface.saveError ).toBe(
			"Couldn't save changes. Retry or discard your edits to continue."
		);
	} );
} );
