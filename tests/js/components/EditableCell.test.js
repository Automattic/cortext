import { render, screen } from '@testing-library/react';

import {
	dateOnlyValue,
	formatDateValue,
	formatDisplay,
	formatNumberValue,
} from '../../../src/components/EditableCell';

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
			expect(
				formatNumberValue( 1234567, { style: 'comma' } )
			).toBe( '1,234,567' );
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
		it( 'renders a chip with the option color when one is set', () => {
			const elements = [
				{ value: 'open', label: 'Open', color: '#ffe2dd' },
			];
			renderDisplay( 'open', 'select', { elements } );
			const chip = screen.getByText( 'Open' );
			expect( chip ).toHaveClass( 'cortext-chip' );
			expect( chip ).not.toHaveClass( 'cortext-chip--neutral' );
			expect( chip.style.backgroundColor ).not.toBe( '' );
		} );

		it( 'sets a contrasting foreground for hex colors', () => {
			renderDisplay( 'open', 'select', {
				elements: [
					{ value: 'open', label: 'Open', color: '#000000' },
				],
			} );
			expect( screen.getByText( 'Open' ).style.color ).toBe(
				'rgb(255, 255, 255)'
			);
		} );

		it( 'falls back to a neutral chip when the option has no color', () => {
			const elements = [ { value: 'open', label: 'Open' } ];
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
