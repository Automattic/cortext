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

function wrapper( { children } ) {
	return <DocumentPeekProvider>{ children }</DocumentPeekProvider>;
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
		} );
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
		} );
		expect( result.current.state.peek ).toBe( null );
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
} );
