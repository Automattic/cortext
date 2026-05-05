import { fireEvent, render, screen, waitFor } from '@testing-library/react';

jest.mock( '@wordpress/api-fetch', () => jest.fn() );
jest.mock( '../../../src/hooks/useCollectionRows', () => ( {
	__esModule: true,
	default: jest.fn(),
} ) );

import {
	dateOnlyValue,
	default as EditableCell,
	formatDateValue,
	formatDisplay,
	formatNumberValue,
	RowMutationContext,
} from '../../../src/components/EditableCell';
import apiFetch from '@wordpress/api-fetch';
import useCollectionRows from '../../../src/hooks/useCollectionRows';

beforeEach( () => {
	apiFetch.mockReset();
	useCollectionRows.mockReturnValue( {
		data: [],
		collection: null,
		isLoading: false,
		refresh: jest.fn(),
	} );
} );

function renderDisplay( value, type, options ) {
	return render( <>{ formatDisplay( value, type, options ) }</> );
}

describe( 'formatDisplay', () => {
	describe( 'empty contract', () => {
		it.each( [ null, undefined, '' ] )(
			'returns the empty string for %p',
			( value ) => {
				expect( formatDisplay( value, 'text' ) ).toBe( '' );
			}
		);
	} );

	describe( 'date / datetime', () => {
		it( 'formats date-only values per the chosen locale', () => {
			expect(
				formatDisplay( '2026-04-16', 'date', {
					format: { style: 'us' },
				} )
			).toBe( '04/16/2026' );
			expect(
				formatDisplay( '2026-04-16', 'date', {
					format: { style: 'eu' },
				} )
			).toBe( '16/04/2026' );
		} );

		it( 'omits time when the format toggles it off', () => {
			const out = formatDisplay( '2026-03-15T14:30:00', 'datetime', {
				format: { style: 'us', time: false },
			} );
			expect( out ).toBe( '03/15/2026' );
		} );

		it( 'honors the 24-hour clock toggle', () => {
			const out = formatDisplay( '2026-03-15T14:30:00', 'datetime', {
				format: { style: 'us', time: true, hour12: false },
			} );
			expect( out ).toContain( '14:30' );
		} );
	} );

	describe( 'number', () => {
		it( 'falls through to plain string when no format is given', () => {
			expect( formatDisplay( 1234, 'number' ) ).toBe( '1234' );
		} );

		it( 'groups thousands when style is comma', () => {
			expect(
				formatDisplay( 1234567, 'number', {
					format: { style: 'comma' },
				} )
			).toBe( '1,234,567' );
		} );

		it( 'renders percent style by multiplying by 100', () => {
			expect(
				formatDisplay( 0.5, 'number', {
					format: { style: 'percent', decimals: 0 },
				} )
			).toBe( '50%' );
		} );

		it( 'applies decimal places', () => {
			expect(
				formatDisplay( 1.2, 'number', {
					format: { style: 'plain', decimals: 3 },
				} )
			).toBe( '1.200' );
		} );

		it( 'renders currency with the chosen ISO code', () => {
			const out = formatNumberValue( 9.95, {
				style: 'currency',
				currency: 'EUR',
				decimals: 2,
			} );
			expect( out ).toMatch( /9[.,]95/ );
			expect( out ).toMatch( /€|EUR/ );
		} );

		it( 'falls back to String for non-numeric input', () => {
			expect( formatNumberValue( 'n/a', { style: 'comma' } ) ).toBe(
				'n/a'
			);
		} );

		it( 'preserves natural precision when no decimals are configured', () => {
			// Existing fields and freshly-saved formats both omit
			// `decimals`. The renderer must not force-truncate them — Intl
			// keeps up to 3 fraction digits by default for plain output,
			// which matches what users expect from "no format set".
			expect( formatDisplay( 1.25, 'number' ) ).toBe( '1.25' );
			expect(
				formatDisplay( 1.25, 'number', {
					format: { style: 'plain' },
				} )
			).toBe( '1.25' );
			expect(
				formatDisplay( 1234.5, 'number', {
					format: { style: 'comma' },
				} )
			).toBe( '1,234.5' );
		} );

		it( 'rounds to the explicit decimals when 0 is picked', () => {
			expect(
				formatDisplay( 1.25, 'number', {
					format: { style: 'plain', decimals: 0 },
				} )
			).toBe( '1' );
		} );

		it( 'follows the WordPress site locale for separators', () => {
			// `@wordpress/date` defaults the locale to 'en' under jest, so
			// the comma case still produces `1,234,567`. If the wiring
			// ever drops back to `undefined`, this still passes in en-US
			// runtimes; the explicit getSettings() check is what catches
			// the regression.
			const { getSettings } = require( '@wordpress/date' );
			expect( getSettings().l10n.locale ).toBe( 'en' );
			expect( formatNumberValue( 1234567, { style: 'comma' } ) ).toBe(
				'1,234,567'
			);
		} );

		it( 'renders a bar visual when display is "bar"', () => {
			const { container } = renderDisplay( 0.4, 'number', {
				format: { style: 'percent', display: 'bar' },
			} );
			const fill = container.querySelector( '.cortext-cell-bar__fill' );
			expect( fill ).not.toBeNull();
			expect( fill.style.width ).toBe( '40%' );
			expect(
				container.querySelector( '.cortext-cell-bar__label' )
					.textContent
			).toBe( '40%' );
		} );

		it( 'renders a ring visual when display is "ring"', () => {
			const { container } = renderDisplay( 25, 'number', {
				format: { style: 'plain', display: 'ring' },
			} );
			expect(
				container.querySelector( '.cortext-cell-ring__svg' )
			).not.toBeNull();
			expect(
				container.querySelector( '.cortext-cell-ring__label' )
					.textContent
			).toBe( '25' );
		} );

		it( 'clamps bar fill to the 0..1 range', () => {
			const { container } = renderDisplay( 250, 'number', {
				format: { style: 'plain', display: 'bar' },
			} );
			expect(
				container.querySelector( '.cortext-cell-bar__fill' ).style.width
			).toBe( '100%' );
		} );

		it( 'divides by the configured max for non-percent fills', () => {
			// The motivating case: 1966 GBP out of 2000 should peg the
			// bar near full instead of 100% (which 1966/100 → clamp would
			// produce).
			const { container } = renderDisplay( 1966, 'number', {
				format: {
					style: 'currency',
					currency: 'GBP',
					display: 'bar',
					divideBy: 2000,
				},
			} );
			expect(
				container.querySelector( '.cortext-cell-bar__fill' ).style.width
			).toBe( '98.3%' );
		} );

		it( 'hides the bar label when showNumber is false', () => {
			const { container } = renderDisplay( 0.4, 'number', {
				format: {
					style: 'percent',
					display: 'bar',
					showNumber: false,
				},
			} );
			expect(
				container.querySelector( '.cortext-cell-bar__label' )
			).toBeNull();
			expect(
				container.querySelector( '.cortext-cell-bar__fill' )
			).not.toBeNull();
		} );

		it( 'applies the chosen palette color to the bar fill', () => {
			const { container } = renderDisplay( 0.5, 'number', {
				format: {
					style: 'percent',
					display: 'bar',
					color: 'green',
				},
			} );
			expect(
				container.querySelector( '.cortext-cell-bar__fill' ).style
					.background
			).toBe( 'rgb(15, 123, 108)' );
		} );
	} );

	describe( 'formatDateValue helper', () => {
		it( 'parses datetime strings and renders without time when toggled off', () => {
			expect(
				formatDateValue( '2026-03-15T14:30:00', 'datetime', {
					style: 'eu',
					time: false,
				} )
			).toBe( '15/03/2026' );
		} );

		it( 'returns String(value) for unparseable input', () => {
			expect( formatDateValue( 'nope', 'datetime', null ) ).toBe(
				'nope'
			);
		} );
	} );

	describe( 'url', () => {
		it( 'renders an http URL as an anchor opening in a new tab', () => {
			renderDisplay( 'https://example.com/path', 'url' );
			const anchor = screen.getByRole( 'link', {
				name: 'https://example.com/path',
			} );
			expect( anchor ).toHaveAttribute(
				'href',
				'https://example.com/path'
			);
			expect( anchor ).toHaveAttribute( 'target', '_blank' );
			expect( anchor ).toHaveAttribute( 'rel', 'noopener noreferrer' );
		} );

		it( 'falls back to plain text for non-http values', () => {
			expect( formatDisplay( 'mailto:foo@example.com', 'url' ) ).toBe(
				'mailto:foo@example.com'
			);
			expect( formatDisplay( '/relative', 'url' ) ).toBe( '/relative' );
		} );
	} );

	describe( 'relation', () => {
		it( 'renders references as collection links', () => {
			window.cortextSettings = {
				adminUrl: 'https://example.test/wp-admin/',
				menuSlug: 'cortext',
			};

			renderDisplay(
				[
					{
						id: 12,
						title: { raw: 'Ada Lovelace' },
						collectionId: 7,
						collectionSlug: 'people',
					},
				],
				'relation'
			);

			expect(
				screen.getByRole( 'link', { name: 'Ada Lovelace' } )
			).toHaveAttribute(
				'href',
				'https://example.test/wp-admin/admin.php?page=cortext&p=%2Fcollection%2Fpeople-7'
			);
		} );
	} );

	describe( 'checkbox', () => {
		it( 'renders an icon for truthy values', () => {
			const { container } = renderDisplay( true, 'checkbox' );
			expect( container.querySelector( 'svg' ) ).not.toBeNull();
		} );

		it( 'returns the empty string for false', () => {
			expect( formatDisplay( false, 'checkbox' ) ).toBe( '' );
		} );
	} );

	describe( 'select', () => {
		it( 'renders a chip with a palette modifier when an option color is set', () => {
			const elements = [
				{ value: 'open', label: 'Open', color: 'blue' },
			];
			renderDisplay( 'open', 'select', { elements } );
			const chip = screen.getByText( 'Open' );
			expect( chip ).toHaveClass( 'cortext-chip--blue' );
			expect( chip ).not.toHaveClass( 'cortext-chip--neutral' );
		} );

		it( 'normalizes non-palette stored colors (e.g. legacy hex) into a palette modifier', () => {
			// Hex from old seeds and Notion imports never themed under
			// dark mode because raw colors don't follow the CSS-variable
			// palette. `resolveDisplayColor` rounds them to a hashed
			// palette name so chips re-skin alongside the rest of the UI.
			renderDisplay( 'open', 'select', {
				elements: [
					{ value: 'open', label: 'Open', color: '#000000' },
				],
			} );
			const chip = screen.getByText( 'Open' );
			expect( chip.className ).toMatch( /cortext-chip--/ );
			expect( chip ).not.toHaveClass( 'cortext-chip--neutral' );
		} );

		it( 'derives a stable palette color when the option has no stored color', () => {
			const elements = [ { value: 'open', label: 'Open' } ];
			renderDisplay( 'open', 'select', { elements } );
			const chip = screen.getByText( 'Open' );
			// Hash-based fallback in `resolveDisplayColor` — assert the
			// chip lands on a palette modifier (any of them) so legacy
			// options without `color` still render colored.
			expect( chip.className ).toMatch( /cortext-chip--/ );
			expect( chip ).not.toHaveClass( 'cortext-chip--neutral' );
		} );

		it( 'renders the explicit default color as a neutral chip', () => {
			const elements = [
				{ value: 'open', label: 'Open', color: 'default' },
			];
			renderDisplay( 'open', 'select', { elements } );
			expect( screen.getByText( 'Open' ) ).toHaveClass(
				'cortext-chip--neutral'
			);
		} );

		it( 'renders a chip labeled with the raw value when not in elements', () => {
			renderDisplay( 'orphan', 'select', { elements: [] } );
			expect( screen.getByText( 'orphan' ) ).toHaveClass(
				'cortext-chip'
			);
		} );
	} );

	describe( 'multiselect', () => {
		it( 'renders one chip per value, each colored from its option', () => {
			const elements = [
				{ value: 'a', label: 'A', color: '#ffe2dd' },
				{ value: 'b', label: 'B', color: '#ddebf1' },
			];
			renderDisplay( [ 'a', 'b' ], 'multiselect', { elements } );
			expect( screen.getByText( 'A' ) ).toHaveClass( 'cortext-chip' );
			expect( screen.getByText( 'B' ) ).toHaveClass( 'cortext-chip' );
			expect( screen.getByText( 'A' ).style.backgroundColor ).not.toBe(
				''
			);
		} );

		it( 'returns the empty string for an empty array', () => {
			expect( formatDisplay( [], 'multiselect', { elements: [] } ) ).toBe(
				''
			);
		} );
	} );
} );

describe( 'dateOnlyValue', () => {
	it( 'preserves date-only storage when date editors emit datetimes', () => {
		expect( dateOnlyValue( '2026-04-16T14:30:00' ) ).toBe( '2026-04-16' );
		expect( dateOnlyValue( '2026-04-16' ) ).toBe( '2026-04-16' );
	} );
} );

describe( 'EditableCell option overrides', () => {
	it( 'uses live option overrides for chip display without remapping fields', () => {
		render(
			<RowMutationContext.Provider
				value={ {
					optionOverrides: {
						'field-7': [
							{ value: 'high', label: 'High', color: 'red' },
						],
					},
				} }
			>
				<EditableCell
					item={ { id: 1, meta: { 'field-7': 'high' } } }
					fieldId="field-7"
					fieldType="select"
					elements={ [
						{ value: 'high', label: 'High', color: 'orange' },
					] }
					label="Priority"
					readOnly
				/>
			</RowMutationContext.Provider>
		);

		expect( screen.getByText( 'High' ) ).toHaveClass( 'cortext-chip--red' );
	} );
} );

describe( 'EditableCell relation editor', () => {
	it( 'saves selected target row ids from the relation picker', async () => {
		useCollectionRows.mockReturnValue( {
			data: [
				{ id: 22, title: { raw: 'Ada Lovelace' } },
				{ id: 33, title: { raw: 'Grace Hopper' } },
			],
			collection: { title: { raw: 'People' } },
			isLoading: false,
			refresh: jest.fn(),
		} );
		const saveRowField = jest.fn().mockResolvedValue( true );

		render(
			<RowMutationContext.Provider value={ { saveRowField } }>
				<EditableCell
					item={ { id: 11, meta: { 'field-5': [] } } }
					fieldId="field-5"
					fieldType="relation"
					label="Assignee"
					relation={ { targetCollectionId: 9, multiple: true } }
				/>
			</RowMutationContext.Provider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Assignee' } ) );
		fireEvent.click( screen.getByText( 'Ada Lovelace' ) );

		await waitFor( () =>
			expect( saveRowField ).toHaveBeenCalledWith( 11, 'field-5', [ 22 ] )
		);
		expect( useCollectionRows ).toHaveBeenCalledWith(
			9,
			expect.objectContaining( { type: 'table' } )
		);
	} );

	it( 'creates a missing target row from the relation picker', async () => {
		const refreshTargetRows = jest.fn();
		useCollectionRows.mockReturnValue( {
			data: [],
			collection: { title: { raw: 'People' } },
			isLoading: false,
			refresh: refreshTargetRows,
		} );
		apiFetch.mockResolvedValue( { id: 44, title: { raw: 'New Ada' } } );
		const saveRowField = jest.fn().mockResolvedValue( true );

		render(
			<RowMutationContext.Provider value={ { saveRowField } }>
				<EditableCell
					item={ { id: 11, meta: { 'field-5': [] } } }
					fieldId="field-5"
					fieldType="relation"
					label="Assignee"
					relation={ { targetCollectionId: 9, multiple: true } }
				/>
			</RowMutationContext.Provider>
		);

		fireEvent.click( screen.getByRole( 'button', { name: 'Assignee' } ) );
		fireEvent.change( screen.getByLabelText( 'Search rows' ), {
			target: { value: 'New Ada' },
		} );
		fireEvent.click(
			screen.getByRole( 'button', { name: 'Create row "New Ada"' } )
		);

		await waitFor( () =>
			expect( apiFetch ).toHaveBeenCalledWith( {
				path: '/cortext/v1/collections/9/rows',
				method: 'POST',
				data: { title: 'New Ada' },
			} )
		);
		await waitFor( () =>
			expect( saveRowField ).toHaveBeenCalledWith( 11, 'field-5', [
				44,
			] )
		);
		expect( refreshTargetRows ).toHaveBeenCalled();
	} );
} );
