import { render, screen } from '@testing-library/react';

import {
	dateOnlyValue,
	formatDisplay,
} from '../../../src/components/EditableCell';

function renderDisplay( value, type, elements ) {
	return render( <>{ formatDisplay( value, type, elements ) }</> );
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
		it( 'formats date-only values as local calendar dates', () => {
			expect( formatDisplay( '2026-04-16', 'date' ) ).toBe(
				new Date( 2026, 3, 16 ).toLocaleDateString()
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
			renderDisplay( 'open', 'select', elements );
			const chip = screen.getByText( 'Open' );
			expect( chip ).toHaveClass( 'cortext-chip' );
			expect( chip ).not.toHaveClass( 'cortext-chip--neutral' );
			expect( chip.style.backgroundColor ).not.toBe( '' );
		} );

		it( 'sets a contrasting foreground for hex colors', () => {
			renderDisplay(
				'open',
				'select',
				[ { value: 'open', label: 'Open', color: '#000000' } ]
			);
			expect( screen.getByText( 'Open' ).style.color ).toBe(
				'rgb(255, 255, 255)'
			);
		} );

		it( 'falls back to a neutral chip when the option has no color', () => {
			const elements = [ { value: 'open', label: 'Open' } ];
			renderDisplay( 'open', 'select', elements );
			expect( screen.getByText( 'Open' ) ).toHaveClass(
				'cortext-chip--neutral'
			);
		} );

		it( 'renders a chip labeled with the raw value when not in elements', () => {
			renderDisplay( 'orphan', 'select', [] );
			expect( screen.getByText( 'orphan' ) ).toHaveClass( 'cortext-chip' );
		} );
	} );

	describe( 'multiselect', () => {
		it( 'renders one chip per value, each colored from its option', () => {
			const elements = [
				{ value: 'a', label: 'A', color: '#ffe2dd' },
				{ value: 'b', label: 'B', color: '#ddebf1' },
			];
			renderDisplay( [ 'a', 'b' ], 'multiselect', elements );
			expect( screen.getByText( 'A' ) ).toHaveClass( 'cortext-chip' );
			expect( screen.getByText( 'B' ) ).toHaveClass( 'cortext-chip' );
			expect( screen.getByText( 'A' ).style.backgroundColor ).not.toBe(
				''
			);
		} );

		it( 'returns the empty string for an empty array', () => {
			expect( formatDisplay( [], 'multiselect', [] ) ).toBe( '' );
		} );
	} );
} );

describe( 'dateOnlyValue', () => {
	it( 'preserves date-only storage when date editors emit datetimes', () => {
		expect( dateOnlyValue( '2026-04-16T14:30:00' ) ).toBe( '2026-04-16' );
		expect( dateOnlyValue( '2026-04-16' ) ).toBe( '2026-04-16' );
	} );
} );
