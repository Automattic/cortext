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
