import { __ } from '@wordpress/i18n';

export default function EmptyState() {
	return (
		<div className="cortext-canvas__empty">
			<p>{ __( 'Select a page to start editing.', 'cortext' ) }</p>
		</div>
	);
}
