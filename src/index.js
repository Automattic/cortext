import { createRoot } from '@wordpress/element';
import { registerCoreBlocks } from '@wordpress/block-library';

import App from './components/App';
import './index.scss';

registerCoreBlocks();

const root = document.getElementById( 'cortext-root' );
if ( root ) {
	createRoot( root ).render( <App /> );
}
