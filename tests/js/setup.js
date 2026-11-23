/* global jest, beforeEach */
import '@testing-library/jest-dom';

// @wordpress/route pulls in @tanstack/router-core, which expects these globals
// at module load. jsdom does not provide them, so use Node's implementations.
import { TextDecoder, TextEncoder } from 'util';

if ( typeof global.TextEncoder === 'undefined' ) {
	global.TextEncoder = TextEncoder;
}
if ( typeof global.TextDecoder === 'undefined' ) {
	global.TextDecoder = TextDecoder;
}

// Core ships the abilities client only as script modules, which the app loads
// at runtime. Tests set what each ability returns.
jest.mock( '../../src/abilities/runAbility', () => ( {
	runAbility: jest.fn(),
} ) );

beforeEach( () => {
	require( '../../src/abilities/runAbility' ).runAbility.mockReset();
} );
