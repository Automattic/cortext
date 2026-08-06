import { act, renderHook } from '@testing-library/react';

import {
	getElementRightInDocument,
	useSubmenuPlacement,
} from '../../../src/hooks/useSubmenuPlacement';

function mockRect( values ) {
	return {
		x: values.left ?? 0,
		y: 0,
		left: values.left ?? 0,
		top: 0,
		right: values.right ?? values.left + values.width,
		bottom: 0,
		width: values.width ?? values.right - values.left,
		height: 0,
		toJSON: () => ( {} ),
	};
}

describe( 'useSubmenuPlacement', () => {
	it( 'opens left when the outer panel flips across an iframe', () => {
		const sourceDocument = { defaultView: {} };
		const frameElement = {
			ownerDocument: document,
			offsetWidth: 140,
			clientLeft: 0,
			getBoundingClientRect: () => mockRect( { left: 480, width: 140 } ),
		};
		sourceDocument.defaultView.frameElement = frameElement;

		const outerAnchor = {
			ownerDocument: sourceDocument,
			getBoundingClientRect: () => mockRect( { left: 12, right: 233 } ),
		};
		const panel = document.createElement( 'div' );
		panel.getBoundingClientRect = () =>
			mockRect( { left: 244, width: 240 } );
		const panelRef = { current: panel };

		const { result } = renderHook( () =>
			useSubmenuPlacement( outerAnchor, panelRef )
		);

		act( () => result.current.open( 'number-format' ) );

		expect( result.current.placement ).toBe( 'left-start' );
		expect( result.current.openKey ).toBe( 'number-format' );
	} );

	it( 'keeps a panel on the right when both rects share a document', () => {
		const outerAnchor = document.createElement( 'button' );
		outerAnchor.getBoundingClientRect = () =>
			mockRect( { left: 370, right: 602 } );
		const panel = document.createElement( 'div' );
		panel.getBoundingClientRect = () =>
			mockRect( { left: 610, width: 240 } );
		const panelRef = { current: panel };

		const { result } = renderHook( () =>
			useSubmenuPlacement( outerAnchor, panelRef )
		);

		act( () => result.current.open( 'number-format' ) );

		expect( result.current.placement ).toBe( 'right-start' );
	} );

	it( "uses the submenu's own viewport when checking overflow", () => {
		const outerAnchor = document.createElement( 'button' );
		outerAnchor.getBoundingClientRect = () =>
			mockRect( { left: 100, right: 200 } );
		const panel = document.createElement( 'div' );
		panel.getBoundingClientRect = () =>
			mockRect( { left: 220, width: 80 } );
		const panelRef = { current: panel };
		const submenu = {
			ownerDocument: { defaultView: { innerWidth: 300 } },
			getBoundingClientRect: () => mockRect( { left: 220, right: 350 } ),
		};

		const { result } = renderHook( () =>
			useSubmenuPlacement( outerAnchor, panelRef )
		);
		result.current.submenuRef.current = submenu;

		act( () => result.current.open( 'number-format' ) );

		expect( result.current.placement ).toBe( 'left-start' );
	} );
} );

describe( 'getElementRightInDocument', () => {
	it( 'includes iframe borders, padding, and scale', () => {
		const sourceDocument = { defaultView: {} };
		const frameElement = document.createElement( 'iframe' );
		frameElement.style.width = '200px';
		frameElement.style.paddingLeft = '3px';
		Object.defineProperty( frameElement, 'offsetWidth', { value: 200 } );
		Object.defineProperty( frameElement, 'clientLeft', { value: 2 } );
		frameElement.getBoundingClientRect = () =>
			mockRect( { left: 300, width: 400 } );
		sourceDocument.defaultView.frameElement = frameElement;

		const element = {
			ownerDocument: sourceDocument,
			getBoundingClientRect: () => mockRect( { left: 10, right: 50 } ),
		};

		expect( getElementRightInDocument( element, document ) ).toBe( 410 );
	} );

	it( 'works through nested, scaled iframes', () => {
		const middleDocument = { defaultView: {} };
		const sourceDocument = { defaultView: {} };

		middleDocument.defaultView.frameElement = {
			ownerDocument: document,
			offsetWidth: 110,
			clientLeft: 1,
			getBoundingClientRect: () => mockRect( { left: 100, width: 220 } ),
		};
		sourceDocument.defaultView.frameElement = {
			ownerDocument: middleDocument,
			offsetWidth: 100,
			clientLeft: 2,
			getBoundingClientRect: () => mockRect( { left: 50, width: 100 } ),
		};

		const element = {
			ownerDocument: sourceDocument,
			getBoundingClientRect: () => mockRect( { left: 10, right: 30 } ),
		};

		expect( getElementRightInDocument( element, document ) ).toBe( 266 );
	} );

	it( 'returns null when the target document is not an ancestor', () => {
		const element = {
			ownerDocument: { defaultView: { frameElement: null } },
			getBoundingClientRect: () => mockRect( { left: 10, right: 30 } ),
		};

		expect( getElementRightInDocument( element, document ) ).toBeNull();
	} );
} );
