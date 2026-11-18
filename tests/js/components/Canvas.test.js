import { act, render, screen } from '@testing-library/react';

let mockIsMobile = false;
let mockReducedMotion = false;
let resizeObserverCallback;

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
jest.mock( '../../../src/components/CortextInserterSidebar', () =>
	jest.fn( () => null )
);
jest.mock( '../../../src/components/CortextLinkSuggestions', () => () => null );
jest.mock( '../../../src/components/mention', () => ( {
	CortextMentions: () => null,
} ) );
jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	DocumentPropertiesProvider: ( { children } ) => children,
} ) );
jest.mock( '../../../src/components/DocumentPublishToggle', () =>
	jest.fn( () => null )
);
jest.mock( '../../../src/components/EditorBody', () => jest.fn( () => null ) );
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
	default: jest.fn( () => null ),
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
	CanvasEditor,
	CanvasInterfaceSkeleton,
} from '../../../src/components/Canvas';
import { useDispatch, useSelect } from '@wordpress/data';
import { definesTrait } from '../../../src/documents/capabilities';
import useAutosave from '../../../src/hooks/useAutosave';
import usePostLock from '../../../src/hooks/usePostLock';
import DocumentPublishToggle from '../../../src/components/DocumentPublishToggle';
import EditorBody from '../../../src/components/EditorBody';
import DocumentInspectorSidebar from '../../../src/components/DocumentInspectorSidebar';
import CortextInserterSidebar from '../../../src/components/CortextInserterSidebar';

function installMatchMedia() {
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
		return mediaQueryList;
	} );
}

describe( 'Canvas secondary sidebar', () => {
	beforeEach( () => {
		mockIsMobile = false;
		mockReducedMotion = false;
		resizeObserverCallback = null;
		installMatchMedia();
		global.ResizeObserver = jest.fn( ( callback ) => {
			resizeObserverCallback = callback;
			return {
				observe: jest.fn(),
				disconnect: jest.fn(),
			};
		} );
	} );

	afterEach( () => {
		jest.restoreAllMocks();
		delete global.ResizeObserver;
	} );

	it( "configures the desktop inserter's width and position together", () => {
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
	} );

	it( 'updates the desktop animation width when the inserter resizes', () => {
		let measuredWidth = 420;
		const rect = jest
			.spyOn( window.Element.prototype, 'getBoundingClientRect' )
			.mockImplementation( function () {
				return {
					width: this.hasAttribute( 'data-motion-closed-x' )
						? measuredWidth
						: 0,
				};
			} );

		const { container } = render(
			<AnimatedSecondarySidebar>
				<div>Library</div>
			</AnimatedSecondarySidebar>
		);
		const sidebar = container.querySelector(
			'.interface-interface-skeleton__secondary-sidebar'
		);

		expect( sidebar ).toHaveAttribute( 'data-motion-open-width', '420' );
		expect( resizeObserverCallback ).toEqual( expect.any( Function ) );

		measuredWidth = 512;
		act( () => resizeObserverCallback() );

		expect( sidebar ).toHaveAttribute( 'data-motion-open-width', '512' );
		rect.mockRestore();
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
		expect(
			screen.getByTestId( 'secondary-sidebar-presence' )
		).toBeInTheDocument();
		expect( screen.queryByText( 'Library' ) ).not.toBeInTheDocument();
	} );
} );

describe( 'Canvas archived lifecycle lock', () => {
	const unlockedPostLock = {
		error: null,
		isAcquiring: false,
		isLocked: false,
		isReadOnly: false,
		isTakeover: false,
		isTakingOver: false,
		retry: jest.fn(),
		takeOver: jest.fn(),
		user: null,
	};
	const editorProps = {
		allFields: [],
		fields: [],
		isActive: true,
		onDisplayedPost: jest.fn(),
		onSwitchPost: jest.fn(),
		postType: 'crtxt_document',
	};

	beforeEach( () => {
		useDispatch.mockReturnValue( {
			disableComplementaryArea: jest.fn(),
			enableComplementaryArea: jest.fn(),
			resetPost: jest.fn(),
			setIsInserterOpened: jest.fn(),
		} );
		useSelect.mockReturnValue( false );
		useAutosave.mockReturnValue( {
			flushNow: jest.fn(),
			isDirty: false,
			isSaving: false,
			lastSavedAt: null,
			status: 'idle',
		} );
		usePostLock.mockReturnValue( unlockedPostLock );
		definesTrait.mockReturnValue( false );
		DocumentPublishToggle.mockClear();
		EditorBody.mockClear();
		DocumentInspectorSidebar.mockClear();
		CortextInserterSidebar.mockClear();
	} );

	it( 'skips locking while archived and reacquires after restore', () => {
		const archivedPost = {
			id: 7,
			status: 'crtxt_archived',
			type: 'crtxt_document',
		};
		const { rerender } = render(
			<CanvasEditor { ...editorProps } post={ archivedPost } />
		);

		expect( usePostLock ).toHaveBeenLastCalledWith( {
			postId: 7,
			postType: 'crtxt_document',
			enabled: false,
		} );
		expect( DocumentPublishToggle.mock.calls.at( -1 )[ 0 ].disabled ).toBe(
			true
		);
		expect( EditorBody.mock.calls.at( -1 )[ 0 ].isLocked ).toBe( true );
		expect(
			DocumentInspectorSidebar.mock.calls.at( -1 )[ 0 ].isLocked
		).toBe( true );

		rerender(
			<CanvasEditor
				{ ...editorProps }
				post={ { ...archivedPost, status: 'publish' } }
			/>
		);

		expect( usePostLock ).toHaveBeenLastCalledWith( {
			postId: 7,
			postType: 'crtxt_document',
			enabled: true,
		} );
		expect( DocumentPublishToggle.mock.calls.at( -1 )[ 0 ].disabled ).toBe(
			false
		);
		expect( EditorBody.mock.calls.at( -1 )[ 0 ].isLocked ).toBe( false );
	} );

	it( 'closes an already-open inserter when the document is archived', () => {
		const setIsInserterOpened = jest.fn();
		useSelect.mockReturnValue( true );
		useDispatch.mockReturnValue( {
			disableComplementaryArea: jest.fn(),
			enableComplementaryArea: jest.fn(),
			resetPost: jest.fn(),
			setIsInserterOpened,
		} );

		render(
			<CanvasEditor
				{ ...editorProps }
				post={ {
					id: 7,
					status: 'crtxt_archived',
					type: 'crtxt_document',
				} }
			/>
		);

		expect( setIsInserterOpened ).toHaveBeenCalledWith( false );
		expect( CortextInserterSidebar ).not.toHaveBeenCalled();
	} );
} );
