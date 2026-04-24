import { __ } from '@wordpress/i18n';
import CollectionTable from '../components/CollectionTable';

export default function EmptyState() {
	return (
		<div className="cortext-canvas__empty">
			<p>{ __( 'Select a page to start editing.', 'cortext' ) }</p>
			<p>
				{ __(
					'Below is a temporary illustration of the "Books" collection, if one exists.',
					'cortext'
				) }
			</p>
			<CollectionTable slug="books" />
		</div>
	);
}
