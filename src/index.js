import { createRoot } from '@wordpress/element';

import { router, RouterProvider } from './router';
import './index.scss';

const root = document.getElementById( 'cortext-root' );
if ( root ) {
	window.cortextRouter = router;
	createRoot( root ).render( <RouterProvider router={ router } /> );
}
