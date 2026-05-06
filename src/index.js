import { createRoot } from '@wordpress/element';
import { registerCoreBlocks } from '@wordpress/block-library';

import { router, RouterProvider } from './router';
import './blocks';
import './index.scss';

registerCoreBlocks();

const root = document.getElementById( 'cortext-root' );
if ( root ) {
	window.cortextRouter = router;
	createRoot( root ).render( <RouterProvider router={ router } /> );
}
