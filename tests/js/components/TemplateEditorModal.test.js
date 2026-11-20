import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';

let mockSaveRowField;
let mockPendingSaves;

jest.mock( '@wordpress/components', () => ( {
	__esModule: true,
	Button: ( { children, label, onClick } ) => (
		<button type="button" onClick={ onClick }>
			{ children ?? label }
		</button>
	),
	Modal: ( { children } ) => <div>{ children }</div>,
	Notice: ( { children } ) => <div role="alert">{ children }</div>,
	SlotFillProvider: ( { children } ) => <>{ children }</>,
	Spinner: () => <div>Loading</div>,
} ) );

jest.mock( '@wordpress/core-data', () => ( {
	__esModule: true,
	useEntityRecord: jest.fn(),
} ) );

jest.mock( '@wordpress/data', () => ( {
	__esModule: true,
	useDispatch: jest.fn( () => ( { resetPost: jest.fn() } ) ),
} ) );

jest.mock( '@wordpress/editor', () => ( {
	__esModule: true,
	EditorProvider: ( { children } ) => <>{ children }</>,
	store: 'editor-store',
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( value ) => value,
} ) );

jest.mock( '@wordpress/icons', () => ( {
	closeSmall: 'closeSmall',
} ) );

jest.mock( '../../../src/hooks/useAutosave', () => ( {
	__esModule: true,
	default: () => ( { flushNow: jest.fn().mockResolvedValue( true ) } ),
} ) );

jest.mock( '../../../src/components/initEditor', () => ( {
	getEditorSettings: () => ( {} ),
} ) );

jest.mock( '../../../src/components/DocumentPropertiesContext', () => ( {
	DocumentPropertiesProvider: ( { children } ) => <>{ children }</>,
} ) );

jest.mock( '../../../src/components/EditorSurfaceContext', () => ( {
	EditorSurfaceProvider: ( { children } ) => <>{ children }</>,
} ) );

jest.mock( '../../../src/components/CortextLinkSuggestions', () => () => null );

jest.mock( '../../../src/components/EditableCell', () => {
	const { createContext } = require( '@wordpress/element' );
	return {
		__esModule: true,
		RowMutationContext: createContext( {} ),
	};
} );

jest.mock( '../../../src/components/EditorBody', () => {
	const React = require( 'react' );
	const {
		RowMutationContext,
	} = require( '../../../src/components/EditableCell' );

	return {
		__esModule: true,
		default: function MockEditorBody() {
			mockSaveRowField =
				React.useContext( RowMutationContext ).saveRowField;
			const { registerPendingSaves } =
				require( '../../../src/components/ActiveEditorContext' ).useActiveEditor();
			React.useEffect(
				() =>
					mockPendingSaves
						? registerPendingSaves( mockPendingSaves )
						: undefined,
				[ registerPendingSaves ]
			);
			return <div data-testid="editor-body" />;
		},
	};
} );

jest.mock( '../../../src/templates', () => ( {
	__esModule: true,
	TEMPLATE_KIND_ROW: 'row',
	TEMPLATE_POST_TYPE: 'crtxt_template',
	notifyTemplatesChanged: jest.fn(),
	updateTemplate: jest.fn(),
} ) );

import { useEntityRecord } from '@wordpress/core-data';
import TemplateEditorModal from '../../../src/components/TemplateEditorModal';
import { notifyTemplatesChanged, updateTemplate } from '../../../src/templates';

describe( 'TemplateEditorModal', () => {
	beforeEach( () => {
		mockSaveRowField = null;
		mockPendingSaves = null;
		updateTemplate.mockReset();
		notifyTemplatesChanged.mockReset();
		useEntityRecord.mockReturnValue( {
			hasResolved: true,
			record: {
				id: 123,
				title: { raw: 'Template' },
				meta: { cortext_template_field_values: {} },
			},
		} );
	} );

	it( 'serializes row template field saves against the latest field value map', async () => {
		let resolveFirst;
		let resolveSecond;
		updateTemplate
			.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						resolveFirst = resolve;
					} )
			)
			.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						resolveSecond = resolve;
					} )
			);

		render(
			<TemplateEditorModal
				collectionId={ 7 }
				fields={ [] }
				kind="row"
				templateId={ 123 }
			/>
		);

		await waitFor( () =>
			expect( mockSaveRowField ).toEqual( expect.any( Function ) )
		);

		let firstSave;
		let secondSave;
		await act( async () => {
			firstSave = mockSaveRowField( 123, 'field-1', 'Open' );
			secondSave = mockSaveRowField( 123, 'field-2', 'High' );
			await Promise.resolve();
		} );

		expect( updateTemplate ).toHaveBeenCalledTimes( 1 );
		expect( updateTemplate ).toHaveBeenNthCalledWith( 1, 123, {
			field_values: { 'field-1': 'Open' },
		} );

		await act( async () => {
			resolveFirst( {
				field_values: { 'field-1': 'Open' },
			} );
			await firstSave;
		} );

		await waitFor( () =>
			expect( updateTemplate ).toHaveBeenCalledTimes( 2 )
		);
		expect( updateTemplate ).toHaveBeenNthCalledWith( 2, 123, {
			field_values: { 'field-1': 'Open', 'field-2': 'High' },
		} );

		await act( async () => {
			resolveSecond( {
				field_values: { 'field-1': 'Open', 'field-2': 'High' },
			} );
			await secondSave;
		} );

		expect( notifyTemplatesChanged ).toHaveBeenCalledWith( {
			kind: 'row',
			collectionId: 7,
		} );
	} );

	it( 'shows a spinner while the template loads', () => {
		useEntityRecord.mockReturnValue( {
			hasResolved: false,
			record: undefined,
		} );

		render( <TemplateEditorModal kind="page" templateId={ 123 } /> );

		expect( screen.getByText( 'Loading' ) ).toBeInTheDocument();
		expect( screen.queryByRole( 'alert' ) ).not.toBeInTheDocument();
	} );

	it( 'shows an error instead of spinning when the template does not load', () => {
		useEntityRecord.mockReturnValue( {
			hasResolved: true,
			record: undefined,
		} );

		render( <TemplateEditorModal kind="page" templateId={ 123 } /> );

		expect( screen.getByRole( 'alert' ) ).toHaveTextContent(
			"Couldn't open the template."
		);
		expect( screen.queryByText( 'Loading' ) ).not.toBeInTheDocument();
		expect( screen.queryByTestId( 'editor-body' ) ).not.toBeInTheDocument();
	} );

	it( 'waits for property saves before closing', async () => {
		let finishSaves;
		mockPendingSaves = jest.fn(
			() =>
				new Promise( ( resolve ) => {
					finishSaves = resolve;
				} )
		);
		const onClose = jest.fn();

		render(
			<TemplateEditorModal
				kind="row"
				templateId={ 123 }
				onClose={ onClose }
			/>
		);
		await screen.findByTestId( 'editor-body' );

		fireEvent.click( screen.getByText( 'Close' ) );
		await waitFor( () => expect( mockPendingSaves ).toHaveBeenCalled() );
		expect( onClose ).not.toHaveBeenCalled();

		await act( async () => finishSaves( true ) );
		expect( onClose ).toHaveBeenCalledTimes( 1 );
	} );

	it( 'stays open with an error when a property save fails', async () => {
		mockPendingSaves = jest.fn().mockResolvedValue( false );
		const onClose = jest.fn();

		render(
			<TemplateEditorModal
				kind="row"
				templateId={ 123 }
				onClose={ onClose }
			/>
		);
		await screen.findByTestId( 'editor-body' );

		await act( async () => {
			fireEvent.click( screen.getByText( 'Close' ) );
		} );

		expect( await screen.findByRole( 'alert' ) ).toHaveTextContent(
			"Couldn't save the template."
		);
		expect( onClose ).not.toHaveBeenCalled();
	} );
} );
