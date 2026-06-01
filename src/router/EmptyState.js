import { __ } from '@wordpress/i18n';

export default function EmptyState() {
	return (
		<div className="cortext-canvas__empty">
			<p>{ __( 'Choose something to edit.', 'cortext' ) }</p>
		</div>
	);
}
