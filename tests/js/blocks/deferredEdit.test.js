/**
 * Tests for the deferred edit lookup that lets Cortext block types register
 * from the shell while their edit components load with the editor chunk.
 */
import { render, screen } from '@testing-library/react';

import { deferredEdit, setBlockEdits } from '../../../src/blocks/deferredEdit';

it( 'renders the edit component set after registration', () => {
	const RegisteredEdit = deferredEdit( 'cortext/test-block' );
	setBlockEdits( {
		'cortext/test-block': ( { attributes } ) => <p>{ attributes.label }</p>,
	} );

	render( <RegisteredEdit attributes={ { label: 'Loaded edit' } } /> );

	expect( screen.getByText( 'Loaded edit' ) ).toBeInTheDocument();
} );
