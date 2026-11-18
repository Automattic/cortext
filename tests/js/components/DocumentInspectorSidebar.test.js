import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useEffect } from '@wordpress/element';

let mockActiveArea;
let mockIsSmall;
const mockEnableComplementaryArea = jest.fn();
const mockDisableComplementaryArea = jest.fn();
const mockFlushActiveEditor = jest.fn();
const mockUnlockEditors = jest.fn();
const mockLockEditors = jest.fn( () => mockUnlockEditors );
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
	collectionSearchQuery: () => ( {} ),
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
		lockEditors: mockLockEditors,
	} ),
} ) );

import apiFetch from '@wordpress/api-fetch';
import {
	DOCUMENT_INSPECTOR,
	InspectorComplementaryArea,
	InspectorFrame,
	PageActionsPanel,
} from '../../../src/components/DocumentInspectorSidebar';

const defaultProps = {
	identifier: DOCUMENT_INSPECTOR,
	isActiveByDefault: true,
	tabs: [ { id: DOCUMENT_INSPECTOR, label: 'Document' } ],
	title: 'Document',
};

describe( 'PageActionsPanel', () => {
	beforeEach( () => {
		apiFetch.mockReset();
		mockFlushActiveEditor.mockReset();
		mockLockEditors.mockClear();
		mockUnlockEditors.mockClear();
		mockSetFavorites.mockReset();
		mockSetHome.mockReset();
	} );

	it( 'removes the trashed page and its cascade from Favorites', async () => {
		apiFetch.mockResolvedValueOnce( {
			id: 7,
			status: 'trash',
			cascade_deleted: [ 8 ],
		} );
		mockSetFavorites.mockResolvedValue( [] );
		render( <PageActionsPanel postId={ 7 } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move to Trash' } )
		);

		await waitFor( () => expect( mockSetFavorites ).toHaveBeenCalled() );
		const updateFavorites = mockSetFavorites.mock.calls[ 0 ][ 0 ];
		expect(
			updateFavorites( [ { id: 7 }, { id: 8 }, { id: 9 } ] )
		).toEqual( [ { id: 9 } ] );
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Move to Trash' } )
			).toBeEnabled()
		);
	} );

	it( 'saves the open editors before moving the page to Trash', async () => {
		mockFlushActiveEditor.mockResolvedValue( true );
		apiFetch.mockResolvedValueOnce( { id: 7, status: 'trash' } );
		render( <PageActionsPanel postId={ 7 } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move to Trash' } )
		);

		await waitFor( () => expect( apiFetch ).toHaveBeenCalled() );
		expect(
			mockFlushActiveEditor.mock.invocationCallOrder[ 0 ]
		).toBeLessThan( apiFetch.mock.invocationCallOrder[ 0 ] );
		expect( mockLockEditors ).toHaveBeenCalledTimes( 1 );
		await waitFor( () =>
			expect( mockUnlockEditors ).toHaveBeenCalledTimes( 1 )
		);
	} );

	it( 'explains when Trash is canceled because saving failed', async () => {
		mockFlushActiveEditor.mockResolvedValue( false );
		render( <PageActionsPanel postId={ 7 } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Move to Trash' } )
		);

		expect(
			await screen.findByText(
				'Could not save changes. Move to Trash was canceled.'
			)
		).toBeInTheDocument();
		expect( apiFetch ).not.toHaveBeenCalled();
		await waitFor( () =>
			expect(
				screen.getByRole( 'button', { name: 'Move to Trash' } )
			).toBeEnabled()
		);
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

describe( 'InspectorFrame', () => {
	it( 'keeps the panels mounted while a lifecycle request locks them', () => {
		const mounts = jest.fn();
		function Panel() {
			useEffect( () => {
				mounts();
			}, [] );
			return null;
		}
		const { rerender } = render(
			<InspectorFrame isLocked={ false }>
				<Panel />
			</InspectorFrame>
		);

		rerender(
			<InspectorFrame isLocked>
				<Panel />
			</InspectorFrame>
		);
		rerender(
			<InspectorFrame isLocked={ false }>
				<Panel />
			</InspectorFrame>
		);

		expect( mounts ).toHaveBeenCalledTimes( 1 );
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
