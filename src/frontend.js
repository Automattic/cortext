/**
 * Frontend entry point for public Cortext pages.
 *
 * Hydrates interactive DataViews instances into containers rendered by
 * the cortext/data-view block's PHP render callback.
 */
import './frontend.scss';

import { createRoot } from '@wordpress/element';

import PublicDataView, {
	PublicDataViewErrorBoundary,
	PublicDataViewErrorFallback,
} from './components/PublicDataView';

document.querySelectorAll( '[data-cortext-data-view]' ).forEach( ( el ) => {
	const script = el.querySelector( '.cortext-dv-init' );
	if ( ! script ) {
		return;
	}

	const root = createRoot( el );
	let init;
	try {
		init = JSON.parse( script.textContent );
	} catch {
		root.render( <PublicDataViewErrorFallback /> );
		return;
	}

	root.render(
		<PublicDataViewErrorBoundary>
			<PublicDataView
				collectionId={ init.collectionId }
				view={ init.view }
			/>
		</PublicDataViewErrorBoundary>
	);
} );
