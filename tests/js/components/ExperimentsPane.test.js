import {
	act,
	fireEvent,
	render,
	screen,
	waitFor,
} from '@testing-library/react';

const mockCreateErrorNotice = jest.fn();
const mockCreateSuccessNotice = jest.fn();

jest.mock( '@wordpress/api-fetch', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

jest.mock( '@wordpress/components', () => ( {
	Notice: ( { children, status } ) => (
		<div role="status" data-status={ status }>
			{ children }
		</div>
	),
	Spinner: () => <span data-testid="spinner" />,
	ToggleControl: ( { label, checked, disabled, help, onChange } ) => (
		<label>
			<span>{ label }</span>
			<input
				type="checkbox"
				checked={ checked }
				disabled={ disabled }
				aria-describedby={ help ? `${ label }-help` : undefined }
				onChange={ ( event ) => onChange( event.target.checked ) }
			/>
			{ help ? <span id={ `${ label }-help` }>{ help }</span> : null }
		</label>
	),
	__experimentalHeading: ( { children, level = 2 } ) => {
		const Tag = `h${ level }`;
		return <Tag>{ children }</Tag>;
	},
	__experimentalText: ( { children } ) => <p>{ children }</p>,
	__experimentalVStack: ( { children } ) => <div>{ children }</div>,
} ) );

jest.mock( '@wordpress/data', () => ( {
	useDispatch: () => ( {
		createErrorNotice: mockCreateErrorNotice,
		createSuccessNotice: mockCreateSuccessNotice,
	} ),
} ) );

jest.mock( '@wordpress/i18n', () => ( {
	__: ( text ) => text,
} ) );

jest.mock( '@wordpress/notices', () => ( {
	store: { name: 'core/notices' },
} ) );

import apiFetch from '@wordpress/api-fetch';
import ExperimentsPane from '../../../src/components/ExperimentsPane';
import { isExperimentEnabled } from '../../../src/settings';

beforeEach( () => {
	apiFetch.mockReset();
	mockCreateErrorNotice.mockReset();
	mockCreateSuccessNotice.mockReset();
	window.cortextSettings = { experiments: {} };
} );

afterEach( () => {
	delete window.cortextSettings;
} );

describe( 'ExperimentsPane', () => {
	it( 'shows an empty state when there are no experiments', async () => {
		apiFetch.mockResolvedValueOnce( {
			canManage: true,
			experiments: [],
		} );

		render( <ExperimentsPane /> );

		expect( screen.getByTestId( 'spinner' ) ).toBeInTheDocument();
		expect(
			await screen.findByText( 'No experiments yet.' )
		).toBeInTheDocument();
	} );

	it( 'shows a permission notice when the user cannot manage experiments', async () => {
		apiFetch.mockResolvedValueOnce( {
			canManage: false,
			experiments: [
				{
					id: 'sample',
					label: 'Sample',
					description: 'Sample description',
					group: 'Labs',
					enabled: false,
				},
			],
		} );

		render( <ExperimentsPane /> );

		expect(
			await screen.findByText(
				'You need to be a site administrator to change experiments.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'checkbox', { name: /Sample/ } )
		).not.toBeInTheDocument();
	} );

	it( 'renders grouped toggles and saves changes', async () => {
		window.cortextSettings.experiments.sample = false;
		apiFetch
			.mockResolvedValueOnce( {
				canManage: true,
				experiments: [
					{
						id: 'sample',
						label: 'Sample',
						description: 'Sample description',
						group: 'Labs',
						enabled: false,
					},
				],
			} )
			.mockResolvedValueOnce( {
				canManage: true,
				experiments: [
					{
						id: 'sample',
						label: 'Sample',
						description: 'Sample description',
						group: 'Labs',
						enabled: true,
					},
				],
			} );

		render( <ExperimentsPane /> );

		expect( await screen.findByText( 'Labs' ) ).toBeInTheDocument();
		const checkbox = screen.getByRole( 'checkbox', { name: /Sample/ } );
		expect( checkbox ).not.toBeChecked();

		fireEvent.click( checkbox );

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenLastCalledWith( {
				path: '/cortext/v1/experiments',
				method: 'PUT',
				data: { enabled: { sample: true } },
			} )
		);
		expect( mockCreateSuccessNotice ).toHaveBeenCalledWith(
			'Experiment updated.',
			expect.objectContaining( {
				id: 'cortext-experiments-updated',
				type: 'snackbar',
			} )
		);
		expect( isExperimentEnabled( 'sample' ) ).toBe( true );
	} );

	it( 'disables every toggle while a save is pending', async () => {
		let resolveSave;
		apiFetch
			.mockResolvedValueOnce( {
				canManage: true,
				experiments: [
					{
						id: 'first',
						label: 'First',
						description: 'First description',
						group: 'Labs',
						enabled: false,
					},
					{
						id: 'second',
						label: 'Second',
						description: 'Second description',
						group: 'Labs',
						enabled: false,
					},
				],
			} )
			.mockImplementationOnce(
				() =>
					new Promise( ( resolve ) => {
						resolveSave = resolve;
					} )
			);

		render( <ExperimentsPane /> );

		const first = await screen.findByRole( 'checkbox', { name: /First/ } );
		const second = screen.getByRole( 'checkbox', { name: /Second/ } );
		fireEvent.click( first );

		await waitFor( () => {
			expect( first ).toBeDisabled();
			expect( second ).toBeDisabled();
		} );
		fireEvent.click( second );
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );
		expect( second ).not.toBeChecked();

		await act( async () => {
			resolveSave( {
				canManage: true,
				experiments: [
					{
						id: 'first',
						label: 'First',
						description: 'First description',
						group: 'Labs',
						enabled: true,
					},
					{
						id: 'second',
						label: 'Second',
						description: 'Second description',
						group: 'Labs',
						enabled: false,
					},
				],
			} );
		} );

		expect( first ).not.toBeDisabled();
		expect( second ).not.toBeDisabled();
	} );

	it( 'reverts only the failed experiment after a save failure', async () => {
		apiFetch
			.mockResolvedValueOnce( {
				canManage: true,
				experiments: [
					{
						id: 'sample',
						label: 'Sample',
						description: 'Sample description',
						group: 'Labs',
						enabled: false,
					},
					{
						id: 'unchanged',
						label: 'Unchanged',
						description: 'Unchanged description',
						group: 'Labs',
						enabled: true,
					},
				],
			} )
			.mockRejectedValueOnce( new Error( 'Nope' ) );

		render( <ExperimentsPane /> );

		const checkbox = await screen.findByRole( 'checkbox', {
			name: /Sample/,
		} );
		const unchanged = screen.getByRole( 'checkbox', {
			name: /Unchanged/,
		} );
		fireEvent.click( checkbox );

		await waitFor( () => expect( checkbox ).not.toBeChecked() );
		expect( unchanged ).toBeChecked();
		expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
			"Couldn't update this experiment.",
			expect.objectContaining( {
				id: 'cortext-experiments-update-failed',
				type: 'snackbar',
			} )
		);
	} );

	it( 'shows an error when experiments fail to load', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'Nope' ) );

		render( <ExperimentsPane /> );

		expect(
			await screen.findByText( "Couldn't load experiments." )
		).toBeInTheDocument();
	} );
} );
