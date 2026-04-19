import { createRoot } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import './index.scss';

function App() {
	return (
		<div className="cortext-shell">
			<h1>{ __( 'Welcome to Cortext', 'cortext' ) }</h1>
			<p>
				{ __(
					'Plugin scaffold is alive. The full-screen editor shell lands next.',
					'cortext'
				) }
			</p>
		</div>
	);
}

const root = document.getElementById( 'cortext-root' );
if ( root ) {
	createRoot( root ).render( <App /> );
}
