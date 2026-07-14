import { fireEvent, render, screen } from '@testing-library/react';

let mockActiveArea;
let mockIsSmall;
const mockEnableComplementaryArea = jest.fn();
const mockDisableComplementaryArea = jest.fn();

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
		Button: ( { children, icon, label, size, ...props } ) => (
			<button { ...props } aria-label={ label }>
				{ children }
			</button>
		),
		Disabled: ( { children } ) => <>{ children }</>,
		Fill: ( { children } ) => <>{ children }</>,
		Notice: ( { children } ) => <>{ children }</>,
		PanelBody: ( { children } ) => <>{ children }</>,
		Slot: ( { children } ) => <>{ children }</>,
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
	closeSmall: 'close-small',
	home: 'home',
	starEmpty: 'star-empty',
	starFilled: 'star-filled',
	trash: 'trash',
} ) );
jest.mock( '@wordpress/interface', () => ( { store: {} } ) );
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
jest.mock( '../../../src/components/SidebarFavorites', () => ( {
	filterFavoritesForTrashedPage: jest.fn(),
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
	useFavorites: () => ( {} ),
} ) );
jest.mock( '../../../src/hooks/useWorkspaceHome', () => ( {
	useWorkspaceHome: () => ( {} ),
} ) );

import {
	DOCUMENT_INSPECTOR,
	InspectorComplementaryArea,
} from '../../../src/components/DocumentInspectorSidebar';

const defaultProps = {
	identifier: DOCUMENT_INSPECTOR,
	isActiveByDefault: true,
	tabs: [ { id: DOCUMENT_INSPECTOR, label: 'Document' } ],
	title: 'Document',
};

describe( 'InspectorComplementaryArea', () => {
	beforeEach( () => {
		mockActiveArea = undefined;
		mockIsSmall = false;
		mockEnableComplementaryArea.mockClear();
		mockDisableComplementaryArea.mockClear();
	} );

	it( 'does not default-open the inspector on a small viewport', () => {
		mockIsSmall = true;

		render( <InspectorComplementaryArea { ...defaultProps } /> );

		expect( mockEnableComplementaryArea ).not.toHaveBeenCalled();
		expect( mockDisableComplementaryArea ).toHaveBeenCalledWith(
			'cortext'
		);
	} );

	it( 'default-opens after an initially small viewport widens', () => {
		mockIsSmall = true;
		const { rerender } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);
		mockEnableComplementaryArea.mockClear();

		mockIsSmall = false;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );

		expect( mockEnableComplementaryArea ).toHaveBeenCalledWith(
			'cortext',
			DOCUMENT_INSPECTOR
		);
	} );

	it( 'default-opens on a large viewport only when visibility is unset', () => {
		const { unmount } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);

		expect( mockEnableComplementaryArea ).toHaveBeenCalledWith(
			'cortext',
			DOCUMENT_INSPECTOR
		);

		unmount();
		mockEnableComplementaryArea.mockClear();
		mockActiveArea = null;
		render( <InspectorComplementaryArea { ...defaultProps } /> );

		expect( mockEnableComplementaryArea ).not.toHaveBeenCalled();
	} );

	it( 'closes when shrinking and reopens after widening', () => {
		mockActiveArea = DOCUMENT_INSPECTOR;
		const { rerender } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);

		mockIsSmall = true;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );
		expect( mockDisableComplementaryArea ).toHaveBeenCalledWith(
			'cortext'
		);

		mockActiveArea = null;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );
		mockIsSmall = false;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );

		expect( mockEnableComplementaryArea ).toHaveBeenCalledWith(
			'cortext',
			DOCUMENT_INSPECTOR
		);
	} );

	it( 'provides an accessible in-panel close control', () => {
		mockActiveArea = DOCUMENT_INSPECTOR;
		render( <InspectorComplementaryArea { ...defaultProps } /> );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'Close inspector' } )
		);

		expect( mockDisableComplementaryArea ).toHaveBeenCalledWith(
			'cortext'
		);
	} );

	it( 'does not animate an inspector that is already active on mount', () => {
		mockActiveArea = DOCUMENT_INSPECTOR;
		const { container } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);
		const fill = container.querySelector( '.cortext-inspector-fill' );

		expect( fill ).toHaveClass( 'is-open', 'is-static', 'is-idle' );
		expect( fill ).not.toHaveClass( 'is-opening' );
	} );

	it( 'does not animate the first default-open transition', () => {
		const { container, rerender } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);

		mockActiveArea = DOCUMENT_INSPECTOR;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );
		const fill = container.querySelector( '.cortext-inspector-fill' );

		expect( fill ).toHaveClass( 'is-open', 'is-static', 'is-idle' );
		expect( fill ).not.toHaveClass( 'is-opening' );
	} );

	it( 'still animates a manual open from an explicit closed state', () => {
		mockActiveArea = null;
		const { container, rerender } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);

		mockActiveArea = DOCUMENT_INSPECTOR;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );
		const fill = container.querySelector( '.cortext-inspector-fill' );

		expect( fill ).toHaveClass( 'is-open', 'is-animated', 'is-opening' );
	} );

	it( 'keeps the closing transition after an active inspector is toggled off', () => {
		mockActiveArea = DOCUMENT_INSPECTOR;
		const { container, rerender } = render(
			<InspectorComplementaryArea { ...defaultProps } />
		);

		mockActiveArea = null;
		rerender( <InspectorComplementaryArea { ...defaultProps } /> );
		const fill = container.querySelector( '.cortext-inspector-fill' );

		expect( fill ).toHaveClass( 'is-closed', 'is-animated', 'is-closing' );
	} );
} );
