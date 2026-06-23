jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

const mockNavigate = jest.fn();

import apiFetch from '@wordpress/api-fetch';

import { retainMentionIconHydratorsForEditorDocument } from '../../../src/components/mention/CortextMentions';
import {
	handleMentionNavigationEvent,
	pathForMentionAnchor,
} from '../../../src/components/mention/navigation';

describe( 'Cortext mention navigation', () => {
	beforeEach( () => {
		apiFetch.mockClear();
		mockNavigate.mockClear();
		// Only the icon hydrator fetches now; keep it resolving so it stays quiet.
		apiFetch.mockResolvedValue( {} );
	} );

	it( 'intercepts the first click inside the editor iframe and navigates through the Cortext router', async () => {
		const iframe = document.createElement( 'iframe' );
		document.body.appendChild( iframe );
		const editorDocument = iframe.contentDocument;
		const anchor = editorDocument.createElement( 'a' );
		anchor.className = 'cortext-mention';
		anchor.setAttribute( 'data-crtxt-mention', '7' );
		anchor.setAttribute( 'data-crtxt-path', 'target-7' );
		anchor.setAttribute( 'href', 'https://example.test/cortext/target/' );
		anchor.textContent = 'Target';
		editorDocument.body.appendChild( anchor );

		const release = retainMentionIconHydratorsForEditorDocument(
			document,
			mockNavigate
		);

		const mouseDown = new MouseEvent( 'mousedown', {
			bubbles: true,
			cancelable: true,
			button: 0,
		} );
		anchor.dispatchEvent( mouseDown );

		expect( mouseDown.defaultPrevented ).toBe( false );
		expect( mockNavigate ).not.toHaveBeenCalled();

		const event = new MouseEvent( 'click', {
			bubbles: true,
			cancelable: true,
			button: 0,
		} );
		anchor.dispatchEvent( event );

		expect( event.defaultPrevented ).toBe( true );
		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'target-7' },
		} );
		release();
		iframe.remove();
	} );

	it( 'uses the stored path snapshot and falls back to the bare id without a network round-trip', () => {
		const withPath = document.createElement( 'a' );
		withPath.setAttribute( 'data-crtxt-mention', '7' );
		withPath.setAttribute( 'data-crtxt-path', 'tasks-7' );

		expect( pathForMentionAnchor( withPath ) ).toBe( 'tasks-7' );

		const withoutPath = document.createElement( 'a' );
		withoutPath.setAttribute( 'data-crtxt-mention', '7' );

		expect( pathForMentionAnchor( withoutPath ) ).toBe( '7' );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'prevents the public href from handling direct mention click events', async () => {
		const anchor = document.createElement( 'a' );
		anchor.setAttribute( 'data-crtxt-mention', '7' );
		anchor.setAttribute( 'data-crtxt-path', 'target-7' );
		document.body.appendChild( anchor );
		const event = new MouseEvent( 'click', {
			bubbles: true,
			cancelable: true,
			button: 0,
		} );
		Object.defineProperty( event, 'target', { value: anchor } );

		expect( handleMentionNavigationEvent( event, mockNavigate ) ).toBe(
			true
		);
		expect( event.defaultPrevented ).toBe( true );
		expect( mockNavigate ).toHaveBeenCalledWith( {
			to: '/$',
			params: { _splat: 'target-7' },
		} );
		anchor.remove();
	} );
} );
