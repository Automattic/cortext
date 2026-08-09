import { fireEvent, render, screen, waitFor } from '@testing-library/react';

let mockActiveArea;
let mockIsSmall;
const mockEnableComplementaryArea = jest.fn();
const mockDisableComplementaryArea = jest.fn();
const mockFlushActiveEditor = jest.fn();
const mockSetFavorites = jest.fn();
const mockSetHome = jest.fn();

jest.mock( '@wordpress/block-editor', () => ( {
	BlockInspector: () => null,
	store: {},
} ) );

jest.mock( '@wordpress/blocks', () => ( {
	createBlock: jest.fn(),
} ) );

jest.mock( '@wordpress/components', () => {
	const React = require( 'react' );
	const TabsContext = React.createContext( {} );
	const Tabs = ( { children } ) => <>{ children }</>;
	Tabs.Context = TabsContext;
	Tabs.Tab = ( { children } ) => <button>{ children }</button>;
	Tabs.TabList = ( { children } ) => <div>{ children }</div>;
	Tabs.TabPanel = ( { children } ) => <div>{ children }</div>;

	return {
		Button: ( { children, className, disabled, label, onClick } ) => (
			<button
				className={ className }
				disabled={ disabled }
				onClick={ onClick }
				aria-label={ label }
			>
				{ children }
			</button>
		),
		Disabled: ( { children } ) => <>{ children }</>,
		Notice: ( { children } ) => <>{ children }</>,
		PanelBody: ( { children } ) => <>{ children }</>,
		privateApis: { Tabs },
	};
} );

jest.mock( '@wordpress/core-data', () => ( {
	store: {},
	useEntityProp: () => [ null, jest.fn() ],
	useEntityRecord: () => ( { record: null } ),
	useEntityRecords: () => ( { records: [] } ),
} ) );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: () => ( {
		disableComplementaryArea: mockDisableComplementaryArea,
		enableComplementaryArea: mockEnableComplementaryArea,
	} ),
	useSelect: ( callback ) =>
		callback( ( store ) => {
			if ( store === 'core/viewport' ) {
				return {
					isViewportMatch: () => mockIsSmall,
				};
			}
			return {
				getActiveComplementaryArea: () => mockActiveArea,
			};
		} ),
} ) );

jest.mock( '@wordpress/editor', () => ( { store: {} } ) );
jest.mock( '@wordpress/i18n', () => ( { __: ( value ) => value } ) );
jest.mock( '@wordpress/icons', () => ( {
	archive: 'archive',
	home: 'home',
	starEmpty: 'star-empty',
	starFilled: 'star-filled',
	trash: 'trash',
} ) );
jest.mock( '@wordpress/interface', () => {
	const ComplementaryArea = ( { children, header } ) => (
		<>
			{ header }
			{ children }
		</>
	);
	ComplementaryArea.Slot = () => null;
	return { ComplementaryArea, store: {} };
} );
jest.mock( '@wordpress/api-fetch', () => jest.fn() );

jest.mock( '../../../src/components/CanvasOwnerInspector', () => ( {
	__esModule: true,
	default: () => null,
	useIsCanvasOwnerSelected: () => false,
} ) );
jest.mock(
	'../../../src/components/DocumentPropertiesActions',
	() => () => null
);
jest.mock( '../../../src/components/BacklinksPanel', () => () => null );
jest.mock( '../../../src/components/MediaPicker', () => ( {
	__esModule: true,
	default: () => null,
	MediaUploadCheck: ( { children } ) => <>{ children }</>,
} ) );
jest.mock( '../../../src/components/DocumentIcon', () => () => null );
jest.mock(
	'../../../src/components/DocumentIdentityControls',
	() => () => null
);
jest.mock( '../../../src/components/Skeleton', () => ( {
	SkeletonBlock: () => null,
} ) );
jest.mock( '../../../src/hooks/useDelayedFlag', () => ( {
	__esModule: true,
	default: () => false,
	SKELETON_MIN_VISIBLE_MS: 0,
} ) );
jest.mock( '../../../src/components/page-queries', () => ( {
	ACTIVE_PAGES_QUERY: {},
	POST_TYPE: 'page',
	TRASHED_PAGES_QUERY: {},
} ) );
jest.mock( '../../../src/collections', () => ( {
	DOCUMENT_POST_TYPE: 'page',
	FULL_PAGE_COLLECTION_QUERY: {},
} ) );
jest.mock( '../../../src/documents/capabilities', () => ( {
	definesTrait: () => false,
} ) );
jest.mock( '../../../src/lock-unlock', () => ( {
	unlock: ( value ) => value,
} ) );
jest.mock( '../../../src/hooks/documentTrashInvalidation', () => ( {
	notifyDocumentTrashChanged: jest.fn(),
} ) );
jest.mock( '../../../src/hooks/useFavorites', () => ( {
	useFavorites: () => ( {
		favorites: [],
		setFavorites: mockSetFavorites,
		isResolving: false,
		isUpdating: false,
	} ),
} ) );
jest.mock( '../../../src/hooks/useWorkspaceHome', () => ( {
	useWorkspaceHome: () => ( {
		home: null,
		setHome: mockSetHome,
		isUpdating: false,
	} ),
} ) );
jest.mock( '../../../src/components/ActiveEditorContext', () => ( {
	useActiveEditor: () => ( {
		flushActiveEditor: mockFlushActiveEditor,
	} ),
} ) );

import {
	collectTrashCascadeIds,
	DOCUMENT_INSPECTOR,
	InspectorComplementaryArea,
	PageActionsPanel,
} from '../../../src/components/DocumentInspectorSidebar';

const defaultProps = {
	identifier: DOCUMENT_INSPECTOR,
	isActiveByDefault: true,
	tabs: [ { id: DOCUMENT_INSPECTOR, label: 'Document' } ],
	title: 'Document',
};

describe( 'collectTrashCascadeIds', () => {
	it( 'includes the root and archived descendants returned by Trash', () => {
		expect(
			Array.from(
				collectTrashCascadeIds( 7, { cascade_deleted: [ 8, 9 ] } )
			)
		).toEqual( [ 7, 8, 9 ] );
	} );
} );

describe( 'PageActionsPanel', () => {
	beforeEach( () => {
		mockFlushActiveEditor.mockReset();
		mockSetFavorites.mockReset();
		mockSetHome.mockReset();
	} );

	it( 'explains when Archive is canceled because saving failed', async () => {
		mockFlushActiveEditor.mockResolvedValue( false );
		render( <PageActionsPanel postId={ 7 } /> );

		fireEvent.click( screen.getByRole( 'button', { name: 'Archive' } ) );

		expect(
			await screen.findByText(
				'Could not save changes. Archive was canceled.'
			)
		).toBeInTheDocument();
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Archive' } )
			).toBeEnabled()
		);
	} );
} );

describe( 'InspectorComplementaryArea', () => {
	beforeEach( () => {
		mockActiveArea = undefined;
		mockIsSmall = false;
		mockEnableComplementaryArea.mockReset();
		mockEnableComplementaryArea.mockImplementation(
			( _scope, identifier ) => {
				mockActiveArea = identifier;
			}
		);
		mockDisableComplementaryArea.mockReset();
		mockDisableComplementaryArea.mockImplementation( () => {
			mockActiveArea = null;
		} );
	} );

	it( 'opens by default after an initially small viewport widens', () => {
		mockIsSmall = true;
		const { rerender } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);
		mockEnableComplementaryArea.mockClear();

		mockActiveArea = null;
		mockIsSmall = false;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );

		expect( mockEnableComplementaryArea ).toHaveBeenCalledWith(
			'cortext',
			DOCUMENT_INSPECTOR
		);
	} );

	it( 'does not reopen after the user opened and closed it', () => {
		mockIsSmall = true;
		const { rerender } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);

		mockActiveArea = DOCUMENT_INSPECTOR;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );
		mockActiveArea = null;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );
		mockIsSmall = false;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );

		expect( mockEnableComplementaryArea ).not.toHaveBeenCalled();
	} );
} );
