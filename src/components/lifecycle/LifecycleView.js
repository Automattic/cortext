import { Icon } from '@wordpress/components';

import './LifecycleView.scss';

function LifecycleViewContent( { state } ) {
	const { documents, hasResolved, error } = state.useDocuments();

	// With items in the view, the sidebar selects one and the canvas opens it,
	// so this pane only has something to say when the view is empty.
	if ( ! hasResolved || error || documents.length > 0 ) {
		return null;
	}

	const { emptyTitle, emptyBody } = state.copy();
	return (
		<div className="cortext-lifecycle">
			<div className="cortext-lifecycle__empty">
				<span className="cortext-lifecycle__empty-icon">
					<Icon icon={ state.icon } size={ 24 } />
				</span>
				<h2>{ emptyTitle }</h2>
				<p>{ emptyBody }</p>
			</div>
		</div>
	);
}

/**
 * The canvas at a lifecycle view's URI (`trash`, `archived`), before an item
 * is selected. Selected items open as documents at `<uri>/<id>`.
 *
 * @param {Object}  props
 * @param {Object}  props.state    Lifecycle state from `lifecycleStates`.
 * @param {boolean} props.isActive Whether the view is showing. The pane only
 *                                 loads while it is.
 */
export default function LifecycleView( { state, isActive } ) {
	return isActive ? <LifecycleViewContent state={ state } /> : null;
}
