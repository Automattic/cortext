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

function experimentsResponse( enabledById = {}, { canManage = true } = {} ) {
	return {
		canManage,
		experiments: Object.entries( enabledById ).map( ( [ id, enabled ] ) => {
			const label = `${ id.charAt( 0 ).toUpperCase() }${ id.slice( 1 ) }`;
			return {
				id,
				label,
				description: `${ label } description`,
				group: 'Labs',
				enabled,
			};
		} ),
	};
}

function deferred() {
	let resolve;
	let reject;
	const promise = new Promise( ( promiseResolve, promiseReject ) => {
		resolve = promiseResolve;
		reject = promiseReject;
	} );
	return { promise, resolve, reject };
}

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
		apiFetch.mockResolvedValueOnce( experimentsResponse() );

		render( <ExperimentsPane /> );

		expect( screen.getByTestId( 'spinner' ) ).toBeInTheDocument();
		expect(
			await screen.findByText( 'Nothing to try right now.' )
		).toBeInTheDocument();
	} );

	it( 'shows a permission notice when the user cannot manage experiments', async () => {
		apiFetch.mockResolvedValueOnce(
			experimentsResponse( { sample: false }, { canManage: false } )
		);

		render( <ExperimentsPane /> );

		expect(
			await screen.findByText(
				'Only site administrators can turn experiments on or off.'
			)
		).toBeInTheDocument();
		expect(
			screen.queryByRole( 'checkbox', { name: /Sample/ } )
		).not.toBeInTheDocument();
	} );

	it( 'renders grouped toggles and saves changes', async () => {
		window.cortextSettings.experiments.sample = false;
		apiFetch
			.mockResolvedValueOnce( experimentsResponse( { sample: false } ) )
			.mockResolvedValueOnce( experimentsResponse( { sample: true } ) );

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
			'Change saved.',
			expect.objectContaining( {
				id: 'cortext-experiments-updated',
				type: 'snackbar',
			} )
		);
		expect( isExperimentEnabled( 'sample' ) ).toBe( true );
	} );

	it( 'keeps toggles interactive and queues their saves', async () => {
		const firstSave = deferred();
		const secondSave = deferred();
		apiFetch
			.mockResolvedValueOnce(
				experimentsResponse( { first: false, second: false } )
			)
			.mockReturnValueOnce( firstSave.promise )
			.mockReturnValueOnce( secondSave.promise );

		render( <ExperimentsPane /> );

		const first = await screen.findByRole( 'checkbox', { name: /First/ } );
		const second = screen.getByRole( 'checkbox', { name: /Second/ } );
		fireEvent.click( first );

		await waitFor( () => {
			expect( first ).toBeChecked();
			expect( first ).not.toBeDisabled();
			expect( second ).not.toBeDisabled();
		} );
		fireEvent.click( second );
		expect( second ).toBeChecked();
		expect( second ).not.toBeDisabled();
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );

		await act( async () => {
			firstSave.resolve(
				experimentsResponse( { first: true, second: false } )
			);
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 3 ) );
		expect( apiFetch ).toHaveBeenLastCalledWith( {
			path: '/cortext/v1/experiments',
			method: 'PUT',
			data: { enabled: { second: true } },
		} );
		expect( first ).not.toBeDisabled();
		expect( first ).toBeChecked();
		expect( second ).not.toBeDisabled();
		expect( second ).toBeChecked();

		await act( async () => {
			secondSave.resolve(
				experimentsResponse( { first: true, second: true } )
			);
		} );

		await waitFor( () => {
			expect( first ).not.toBeDisabled();
			expect( second ).not.toBeDisabled();
		} );
		expect( first ).toBeChecked();
		expect( second ).toBeChecked();
	} );

	it( 'keeps the latest value when the same toggle changes again', async () => {
		const firstSave = deferred();
		const secondSave = deferred();
		apiFetch
			.mockResolvedValueOnce( experimentsResponse( { sample: false } ) )
			.mockReturnValueOnce( firstSave.promise )
			.mockReturnValueOnce( secondSave.promise );

		render( <ExperimentsPane /> );

		const checkbox = await screen.findByRole( 'checkbox', {
			name: /Sample/,
		} );
		fireEvent.click( checkbox );
		fireEvent.click( checkbox );

		expect( checkbox ).not.toBeChecked();
		expect( checkbox ).not.toBeDisabled();
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );

		await act( async () => {
			firstSave.resolve( experimentsResponse( { sample: true } ) );
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 3 ) );
		expect( checkbox ).not.toBeChecked();

		await act( async () => {
			secondSave.reject( new Error( 'Nope' ) );
		} );

		await waitFor( () => expect( checkbox ).toBeChecked() );
		expect( checkbox ).not.toBeDisabled();
	} );

	it( 'reverts only the failed experiment and continues queued saves', async () => {
		const firstSave = deferred();
		const secondSave = deferred();
		apiFetch
			.mockResolvedValueOnce(
				experimentsResponse( { first: false, second: false } )
			)
			.mockReturnValueOnce( firstSave.promise )
			.mockReturnValueOnce( secondSave.promise );

		render( <ExperimentsPane /> );

		const first = await screen.findByRole( 'checkbox', {
			name: /First/,
		} );
		const second = screen.getByRole( 'checkbox', {
			name: /Second/,
		} );
		fireEvent.click( first );
		fireEvent.click( second );

		expect( first ).toBeChecked();
		expect( second ).toBeChecked();
		expect( apiFetch ).toHaveBeenCalledTimes( 2 );

		await act( async () => {
			firstSave.reject( new Error( 'Nope' ) );
		} );

		await waitFor( () => expect( apiFetch ).toHaveBeenCalledTimes( 3 ) );
		expect( first ).not.toBeChecked();
		expect( first ).not.toBeDisabled();
		expect( second ).toBeChecked();
		expect( second ).not.toBeDisabled();
		expect( mockCreateErrorNotice ).toHaveBeenCalledWith(
			"We couldn't save that change.",
			expect.objectContaining( {
				id: 'cortext-experiments-update-failed',
				type: 'snackbar',
			} )
		);

		await act( async () => {
			secondSave.resolve(
				experimentsResponse( { first: false, second: true } )
			);
		} );

		await waitFor( () => expect( second ).not.toBeDisabled() );
		expect( first ).not.toBeChecked();
		expect( second ).toBeChecked();
	} );

	it( 'shows an error when experiments fail to load', async () => {
		apiFetch.mockRejectedValueOnce( new Error( 'Nope' ) );

		render( <ExperimentsPane /> );

		expect(
			await screen.findByText( "We couldn't load experiments." )
		).toBeInTheDocument();
	} );
} );
