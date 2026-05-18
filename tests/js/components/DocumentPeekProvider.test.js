/**
 * Tests for the DocumentPeekProvider state machine: mode stickiness, full
 * navigation, close, and source-driven adjacent-row navigation.
 *
 * RowDetailView and the sidebar SlotFill are mocked away so the test only
 * exercises state transitions, not the actual surface render (that needs
 * core-data and an editor store, which is out of scope for these tests).
 */

import { act, render, renderHook } from '@testing-library/react';

const mockNavigate = jest.fn();
jest.mock( '@wordpress/route', () => ( {
	useNavigate: () => mockNavigate,
} ) );

jest.mock( '../../../src/hooks/useCollectionFields', () => ( {
	__esModule: true,
	default: () => ( { fields: [], isResolving: false } ),
} ) );

jest.mock( '../../../src/components/RowDetailView', () => ( {
	__esModule: true,
	default: () => null,
} ) );

jest.mock( '../../../src/components/RowDetailSidebarSlot', () => ( {
	RowDetailSidebar: {
		Slot: () => null,
		Fill: ( { children } ) => children,
	},
} ) );

import {
	DocumentPeekProvider,
	useDocumentPeekActions,
	useDocumentPeekState,
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

beforeEach( () => {
	mockNavigate.mockReset();
} );

describe( 'DocumentPeekProvider', () => {
	it( 'opens a peek using the caller mode when nothing is open', async () => {
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

	it( 'keeps the open peek mode even when the caller prefers another', async () => {
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

	it( 'navigates to the row URL for full mode and leaves no peek', async () => {
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
				source: { kind: 'collection', getRowList: () => rows },
			} );
		} );

		expect( result.current.state.peek?.docId ).toBe( 10 );
	} );

	it( 'requestMode for full navigates without losing the peek slug', async () => {
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

	it( 'throws when actions are used outside the provider', () => {
		const spy = jest.spyOn( console, 'error' ).mockImplementation( () => {} );
		expect( () => render( <ConsumerWithoutProvider /> ) ).toThrow(
			/DocumentPeekProvider/
		);
		spy.mockRestore();
	} );
} );

function ConsumerWithoutProvider() {
	useDocumentPeekActions();
	return null;
}
