import { createPortal, useLayoutEffect, useState } from '@wordpress/element';

import DataViewNewRowButton from './DataViewNewRowButton';

const GRID_VIEW_SELECTOR = '.dataviews-view-grid';
const GRID_ROW_SELECTOR = '.dataviews-view-grid__row';
const GRID_ITEMS_SELECTOR = '.dataviews-view-grid-items';
const GRID_PORTAL_TARGET_SELECTOR = [
	GRID_ITEMS_SELECTOR,
	GRID_ROW_SELECTOR,
	GRID_VIEW_SELECTOR,
].join( ',' );

// tech-debt.md#td-dataviews-layout-slots: DataViews has no grid append-card slot, so rows with data use
// a portal into the rendered grid.
export default function GridNewRowPortal( {
	wrapperRef,
	collectionId,
	view,
	fields,
	onCreated,
	disabled,
	hasRows,
} ) {
	const [ portalTarget, setPortalTarget ] = useState( null );

	useLayoutEffect( () => {
		const root = wrapperRef.current;
		if ( ! root ) {
			return undefined;
		}

		const updatePortalTarget = () => {
			const targets = Array.from(
				root.querySelectorAll( GRID_PORTAL_TARGET_SELECTOR )
			);
			const nextTarget = targets.length
				? targets[ targets.length - 1 ]
				: null;
			setPortalTarget( ( currentTarget ) =>
				currentTarget === nextTarget ? currentTarget : nextTarget
			);
		};

		updatePortalTarget();

		const Observer = root.ownerDocument?.defaultView?.MutationObserver;
		if ( ! Observer ) {
			return undefined;
		}

		const observer = new Observer( updatePortalTarget );
		observer.observe( root, {
			childList: true,
			subtree: true,
		} );

		return () => observer.disconnect();
	}, [ hasRows, view, wrapperRef ] );

	const newRowCard = (
		<DataViewNewRowButton
			collectionId={ collectionId }
			view={ view }
			fields={ fields }
			onCreated={ onCreated }
			disabled={ disabled }
			presentation="grid-card"
		/>
	);

	if ( portalTarget ) {
		const portalChild = portalTarget.matches( GRID_ROW_SELECTOR ) ? (
			<div
				role="gridcell"
				className="dataviews-view-grid__row__gridcell cortext-data-view__new-row-gridcell"
			>
				{ newRowCard }
			</div>
		) : (
			newRowCard
		);
		return createPortal( portalChild, portalTarget );
	}

	if ( ! hasRows ) {
		const previewSize = view?.layout?.previewSize;
		return (
			<div
				className="cortext-data-view__grid-new-row"
				style={
					previewSize
						? { '--cortext-grid-card-min': `${ previewSize }px` }
						: undefined
				}
			>
				{ newRowCard }
			</div>
		);
	}

	return null;
}
