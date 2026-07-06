import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import apiFetch from '@wordpress/api-fetch';

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( value ) => value,
	sprintf: ( template, value ) => template.replace( '%s', value ),
} ) );

jest.mock( '@wordpress/icons', () => ( {
	chevronDown: 'chevronDown',
	page: 'page',
	plus: 'plus',
} ) );

jest.mock( '@wordpress/components', () => {
	const React = require( 'react' );
	return {
		__esModule: true,
		Button: ( { children, label, onClick, disabled, isBusy } ) => (
			<button
				type="button"
				aria-label={ label }
				onClick={ onClick }
				disabled={ disabled || isBusy }
			>
				{ children || label }
			</button>
		),
		Dropdown: ( { renderToggle, renderContent } ) => {
			const [ isOpen, setIsOpen ] = React.useState( false );
			return (
				<div>
					{ renderToggle( {
						isOpen,
						onToggle: () => setIsOpen( ( current ) => ! current ),
					} ) }
					{ isOpen ? (
						<div role="menu">
							{ renderContent( {
								onClose: () => setIsOpen( false ),
							} ) }
						</div>
					) : null }
				</div>
			);
		},
		MenuGroup: ( { children } ) => <div>{ children }</div>,
		MenuItem: ( { children, onClick } ) => (
			<button type="button" role="menuitem" onClick={ onClick }>
				{ children }
			</button>
		),
		Notice: ( { children } ) => <div role="alert">{ children }</div>,
	};
} );

jest.mock( '../../../src/templates', () => ( {
	__esModule: true,
	createTemplate: jest.fn(),
	instantiateTemplate: jest.fn(),
	notifyTemplatesChanged: jest.fn(),
	TEMPLATE_KIND_ROW: 'row',
	useTemplates: jest.fn(),
} ) );

jest.mock( '../../../src/components/TemplateEditorModal', () => ( props ) => (
	<div data-testid="template-editor-modal">{ props.templateId }</div>
) );

import DataViewNewRowButton from '../../../src/components/DataViewNewRowButton';
import {
	createTemplate,
	instantiateTemplate,
	notifyTemplatesChanged,
	useTemplates,
} from '../../../src/templates';

const fields = [
	{ id: 'field-1', editable: true, cortextType: 'text' },
	{ id: 'field-2', editable: false, cortextType: 'text' },
	{ id: 'field-3', editable: true, cortextType: 'rollup' },
	{ id: 'title', editable: true, cortextType: 'title' },
];

beforeEach( () => {
	apiFetch.mockReset();
	createTemplate.mockReset();
	instantiateTemplate.mockReset();
	notifyTemplatesChanged.mockReset();
	useTemplates.mockReset();
	useTemplates.mockReturnValue( { templates: [] } );
} );

function renderButton( props = {} ) {
	return render(
		<DataViewNewRowButton
			collectionId={ 7 }
			view={ { filters: [] } }
			fields={ fields }
			onCreated={ jest.fn() }
			{ ...props }
		/>
	);
}

describe( 'DataViewNewRowButton templates', () => {
	it( 'uses the view default template and sends eligible filter prefills as overrides', async () => {
		const onCreated = jest.fn();
		const template = { id: 10, title: 'Task starter' };
		// A second template keeps the `templates.length === 1` fallback from
		// reaching id 10, so the assertion below only passes if the
		// defaultRowTemplateId lookup resolves it.
		useTemplates.mockReturnValue( {
			templates: [ template, { id: 11, title: 'Other starter' } ],
		} );
		instantiateTemplate.mockResolvedValueOnce( { id: 99 } );

		renderButton( {
			onCreated,
			view: {
				defaultRowTemplateId: 10,
				filters: [
					{ field: 'field-1', operator: 'is', value: 'Active' },
					{ field: 'field-2', operator: 'is', value: 'Ignored' },
					{ field: 'field-3', operator: 'is', value: 'Rollup' },
					{ field: 'field-1', operator: 'isAny', value: 'Skipped' },
				],
			},
		} );

		fireEvent.click( screen.getByRole( 'button', { name: 'New' } ) );

		await waitFor( () =>
			expect( instantiateTemplate ).toHaveBeenCalledWith( 10, {
				field_values: { 'field-1': 'Active' },
			} )
		);
		expect( onCreated ).toHaveBeenCalledWith( { id: 99 } );
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'does not create a blank row while row templates are still loading', () => {
		useTemplates.mockReturnValue( {
			templates: [],
			isResolving: true,
		} );

		renderButton( {
			view: {
				defaultRowTemplateId: 10,
				filters: [],
			},
		} );

		const primaryButton = screen.getByRole( 'button', { name: 'New' } );
		const optionsButton = screen.getByRole( 'button', {
			name: 'New row menu',
		} );

		expect( primaryButton ).toBeDisabled();
		expect( optionsButton ).toBeDisabled();

		fireEvent.click( primaryButton );

		expect( instantiateTemplate ).not.toHaveBeenCalled();
		expect( apiFetch ).not.toHaveBeenCalled();
	} );

	it( 'creates from a selected template in the options menu', async () => {
		useTemplates.mockReturnValue( {
			templates: [
				{ id: 10, title: 'Alpha' },
				{ id: 11, title: 'Beta' },
			],
		} );
		instantiateTemplate.mockResolvedValueOnce( { id: 100 } );

		renderButton();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'New row menu' } )
		);
		fireEvent.click(
			screen.getByRole( 'menuitem', {
				name: 'New from Alpha',
			} )
		);

		await waitFor( () =>
			expect( instantiateTemplate ).toHaveBeenCalledWith( 10, {
				field_values: {},
			} )
		);
	} );

	it( 'creates a blank row when the picker blank action is selected', async () => {
		const onCreated = jest.fn();
		useTemplates.mockReturnValue( {
			templates: [
				{ id: 10, title: 'Alpha' },
				{ id: 11, title: 'Beta' },
			],
		} );
		apiFetch.mockResolvedValueOnce( { id: 101 } );

		renderButton( { onCreated } );

		fireEvent.click(
			screen.getByRole( 'button', { name: 'New row menu' } )
		);
		fireEvent.click(
			screen.getByRole( 'menuitem', {
				name: 'Blank row',
			} )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/wp/v2/crtxt_documents',
				method: 'POST',
				data: {
					status: 'private',
					title: '',
					cortext_trait: 7,
				},
			} )
		);
		expect( onCreated ).toHaveBeenCalledWith( { id: 101 } );
	} );

	it( 'uses the only available template without opening a picker', async () => {
		const template = { id: 22, title: 'Only template' };
		useTemplates.mockReturnValue( { templates: [ template ] } );
		instantiateTemplate.mockResolvedValueOnce( { id: 102 } );

		renderButton();

		fireEvent.click( screen.getByRole( 'button', { name: 'New' } ) );

		expect(
			screen.queryByRole( 'menuitem', {
				name: 'New from Only template',
			} )
		).toBeNull();
		await waitFor( () =>
			expect( instantiateTemplate ).toHaveBeenCalledWith( 22, {
				field_values: {},
			} )
		);
	} );

	it( 'creates a template and opens it in the template editor', async () => {
		createTemplate.mockResolvedValueOnce( { id: 123 } );

		renderButton();

		fireEvent.click(
			screen.getByRole( 'button', { name: 'New row menu' } )
		);
		fireEvent.click(
			screen.getByRole( 'menuitem', {
				name: 'New template',
			} )
		);

		await waitFor( () =>
			expect( createTemplate ).toHaveBeenCalledWith( {
				kind: 'row',
				collection_id: 7,
				title: 'Untitled template',
			} )
		);
		expect( notifyTemplatesChanged ).toHaveBeenCalledWith( {
			kind: 'row',
			collectionId: 7,
		} );
		expect(
			await screen.findByTestId( 'template-editor-modal' )
		).toHaveTextContent( '123' );
	} );
} );
