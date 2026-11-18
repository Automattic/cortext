import { __ } from '@wordpress/i18n';
import { Icon } from '@wordpress/components';
import { trash as trashIcon } from '@wordpress/icons';

import './TrashView.scss';

import useTrashedDocuments from '../../hooks/useTrashedDocuments';

function TrashViewContent() {
	const { documents, hasResolved, error } = useTrashedDocuments();

	// With items in Trash, the sidebar selects one and the canvas opens it, so
	// this pane only has something to say when Trash is empty.
	if ( ! hasResolved || error || documents.length > 0 ) {
		return null;
	}

	return (
		<div className="cortext-trash">
			<div className="cortext-trash__empty">
				<span className="cortext-trash__empty-icon">
					<Icon icon={ trashIcon } size={ 24 } />
				</span>
				<h2>{ __( 'Nothing in Trash', 'cortext' ) }</h2>
				<p>
					{ __(
						'Documents you move to Trash show up here with where they came from. They stay for 30 days, then they are deleted for good.',
						'cortext'
					) }
				</p>
			</div>
		</div>
	);
}

/**
 * The canvas at `trash`, before an item is selected. Selected items open as
 * documents at `trash/<id>`.
 *
 * @param {Object}  props
 * @param {boolean} props.isActive Whether Trash is showing. The pane only
 *                                 loads while it is.
 */
export default function TrashView( { isActive } ) {
	return isActive ? <TrashViewContent /> : null;
}
