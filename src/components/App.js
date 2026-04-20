import { useState } from '@wordpress/element';
import { __ } from '@wordpress/i18n';

import Sidebar from './Sidebar';
import Canvas from './Canvas';

function EmptyState() {
	return (
		<div className="cortext-canvas__empty">
			<p>{ __( 'Select a page to start editing.', 'cortext' ) }</p>
		</div>
	);
}

export default function App() {
	const [ selectedId, setSelectedId ] = useState( null );

	return (
		<div className="cortext-shell">
			<Sidebar selectedId={ selectedId } onSelect={ setSelectedId } />
			<main className="cortext-shell__canvas">
				{ selectedId ? (
					<Canvas postId={ selectedId } key={ selectedId } />
				) : (
					<EmptyState />
				) }
			</main>
		</div>
	);
}
