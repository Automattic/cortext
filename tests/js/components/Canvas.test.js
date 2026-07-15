import { render, screen } from '@testing-library/react';

let mockIsMobile = false;
let mockReducedMotion = false;
let mediaQueryLists = [];

jest.mock( '@wordpress/i18n', () => ( { __: ( value ) => value } ) );
jest.mock( '@wordpress/core-data', () => ( { useEntityRecord: jest.fn() } ) );
jest.mock( '@wordpress/data', () => ( {
	useDispatch: jest.fn(),
	useSelect: jest.fn(),
} ) );
jest.mock( '@wordpress/editor', () => ( {
	EditorProvider: ( { children } ) => children,
	store: {},
} ) );
jest.mock( '@wordpress/interface', () => ( { store: {} } ) );
jest.mock( '@wordpress/components', () => {
	const React = require( 'react' );
	const MotionDiv = React.forwardRef(
		(
			{
				animate,
				children,
				exit,
				initial,
				transition,
				variants,
				...props
			},
			ref
		) => (
			<div
				ref={ ref }
				data-motion-animate={ animate }
				data-motion-closed-x={ variants?.closed?.x }
				data-motion-exit={ exit }
				data-motion-initial={ initial }
				data-motion-open-width={ variants?.open?.width }
				data-motion-duration={ transition?.duration }
				{ ...props }
			>
				{ children }
			</div>
		)
	);
	MotionDiv.displayName = 'MotionDiv';

	return {
		__unstableAnimatePresence: ( { children, initial } ) => (
			<div
				data-testid="secondary-sidebar-presence"
				data-initial={ String( initial ) }
			>
				{ children }
			</div>
		),
		__unstableMotion: { div: MotionDiv },
		Button: ( { children } ) => <button>{ children }</button>,
	};
} );
jest.mock( '@wordpress/icons', () => ( {
	closeSmall: 'close-small',
	cog: 'cog',
	pencil: 'pencil',
	plus: 'plus',
	seen: 'seen',
	unseen: 'unseen',
} ) );

jest.mock( '../../../src/components/initEditor', () => ( {
	getEditorSettings: jest.fn(),
} ) );
jest.mock( '../../../src/hooks/useAutosave', () => jest.fn() );
jest.mock( '../../../src/hooks/useDelayedFlag', () => jest.fn() );
jest.mock( '../../../src/hooks/usePostLock', () => jest.fn() );
jest.mock( '../../../src/hooks/viewTransition', () => ( {
	withViewTransition: jest.fn(),
} ) );
jest.mock( '../../../src/hooks/backlinksInvalidation', () => ( {
	notifyBacklinksChanged: jest.fn(),
} ) );
jest.mock( '../../../src/documents/capabilities', () => ( {
	definesTrait: jest.fn(),
} ) );
jest.mock( '../../../src/components/page-queries', () => ( {
	POST_TYPE: 'crtxt_document',
} ) );
jest.mock( '../../../src/components/CortextInserterSidebar', () => () => null );
jest.mock( '../../../src/components/CortextLinkSuggestions', () => () => null );
jest.mock( '../../../src/components/mention', () => ( {
	CortextMentions: () => null,
} ) );
jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	DocumentPropertiesProvider: ( { children } ) => children,
} ) );
jest.mock( '../../../src/components/DocumentPublishToggle', () => () => null );
jest.mock( '../../../src/components/EditorBody', () => () => null );
jest.mock( '../../../src/components/PostLockControls', () => ( {
	PostLockFailureNotice: () => null,
	PostLockModal: () => null,
} ) );
jest.mock( '../../../src/components/Skeleton', () => ( {
	CanvasProgressBar: () => null,
} ) );
jest.mock( '../../../src/components/WorkspaceTopBar', () => ( {
	TopBarActionsFill: ( { children } ) => children,
} ) );
jest.mock( '../../../src/components/DocumentInspectorSidebar', () => ( {
	__esModule: true,
	default: () => null,
	DOCUMENT_INSPECTOR: 'cortext/document-inspector',
	INSPECTOR_SCOPE: 'cortext',
	InspectorSidebarSlot: () => null,
	getActiveInspectorArea: jest.fn(),
	isInspectorArea: jest.fn(),
} ) );
jest.mock( '../../../src/router/rowContextCache', () => ( {
	makeRowDocumentContext: jest.fn(),
	rememberRowDocumentContext: jest.fn(),
	rowDocumentContextForEditorPost: jest.fn(),
} ) );

import {
	AnimatedSecondarySidebar,
	CanvasInterfaceSkeleton,
} from '../../../src/components/Canvas';

function installMatchMedia() {
	mediaQueryLists = [];
	window.matchMedia = jest.fn( ( query ) => {
		const mediaQueryList = {
			matches: query.includes( 'max-width' )
				? mockIsMobile
				: mockReducedMotion,
			addEventListener: jest.fn(),
			removeEventListener: jest.fn(),
			addListener: jest.fn(),
			removeListener: jest.fn(),
		};
		mediaQueryLists.push( mediaQueryList );
		return mediaQueryList;
	} );
}

describe( 'Canvas secondary sidebar', () => {
	beforeEach( () => {
		mockIsMobile = false;
		mockReducedMotion = false;
		installMatchMedia();
		global.ResizeObserver = jest.fn( () => ( {
			observe: jest.fn(),
			disconnect: jest.fn(),
		} ) );
	} );

	afterEach( () => {
		delete global.ResizeObserver;
	} );

	it( "animates the desktop inserter's width and position together", () => {
		const { container } = render(
			<AnimatedSecondarySidebar>
				<div>Library</div>
			</AnimatedSecondarySidebar>
		);
		const sidebar = container.querySelector(
			'.interface-interface-skeleton__secondary-sidebar'
		);
		const content = container.querySelector(
			'[data-motion-closed-x="-100%"]'
		);

		expect( sidebar ).toHaveAttribute( 'data-motion-initial', 'closed' );
		expect( sidebar ).toHaveAttribute( 'data-motion-animate', 'open' );
		expect( sidebar ).toHaveAttribute( 'data-motion-exit', 'closed' );
		expect( sidebar ).toHaveAttribute( 'data-motion-open-width', '350' );
		expect( sidebar ).toHaveAttribute( 'data-motion-duration', '0.25' );
		expect( content ).toHaveAttribute( 'data-motion-duration', '0.25' );
		expect(
			mediaQueryLists.every(
				( mediaQueryList ) =>
					mediaQueryList.addListener.mock.calls.length === 0
			)
		).toBe( true );
	} );

	it( 'opens at viewport width without motion on mobile', () => {
		mockIsMobile = true;
		const { container } = render(
			<AnimatedSecondarySidebar>
				<div>Library</div>
			</AnimatedSecondarySidebar>
		);
		const sidebar = container.querySelector(
			'.interface-interface-skeleton__secondary-sidebar'
		);

		expect( sidebar ).toHaveAttribute( 'data-motion-open-width', '100vw' );
		expect( sidebar ).toHaveAttribute( 'data-motion-duration', '0' );
	} );

	it( 'disables the desktop transition when reduced motion is requested', () => {
		mockReducedMotion = true;
		const { container } = render(
			<AnimatedSecondarySidebar>
				<div>Library</div>
			</AnimatedSecondarySidebar>
		);
		const sidebar = container.querySelector(
			'.interface-interface-skeleton__secondary-sidebar'
		);

		expect( sidebar ).toHaveAttribute( 'data-motion-open-width', '350' );
		expect( sidebar ).toHaveAttribute( 'data-motion-duration', '0' );
	} );

	it( 'keeps the presence wrapper mounted when the sidebar closes', () => {
		const { rerender } = render(
			<CanvasInterfaceSkeleton
				content={ <div>Document</div> }
				secondarySidebar={ <div>Library</div> }
			/>
		);

		expect(
			screen.getByTestId( 'secondary-sidebar-presence' )
		).toHaveAttribute( 'data-initial', 'false' );
		expect( screen.getByText( 'Library' ) ).toBeInTheDocument();

		rerender(
			<CanvasInterfaceSkeleton
				content={ <div>Document</div> }
				secondarySidebar={ null }
			/>
		);
		expect( screen.queryByText( 'Library' ) ).not.toBeInTheDocument();
	} );
} );
