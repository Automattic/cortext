import { createPortal, useLayoutEffect, useState } from '@wordpress/element';

import DataViewNewRowButton from './DataViewNewRowButton';

const GRID_VIEW_SELECTOR = '.dataviews-view-grid';

// tech-debt.md#7: DataViews has no grid append-card slot, so rows with data use
// a portal into the rendered grid.
export default function GridNewRowPortal( {
	wrapperRef,
	slug,
	view,
	fields,
	onCreated,
	disabled,
	hasRows,
} ) {
	const [ gridElement, setGridElement ] = useState( null );

	useLayoutEffect( () => {
		const grids = Array.from(
			wrapperRef.current?.querySelectorAll( GRID_VIEW_SELECTOR ) ?? []
		);
		const nextGrid = grids.length ? grids[ grids.length - 1 ] : null;
		setGridElement( ( currentGrid ) =>
			currentGrid === nextGrid ? currentGrid : nextGrid
		);
	}, [ hasRows, wrapperRef ] );

	const newRowCard = (
		<DataViewNewRowButton
			slug={ slug }
			view={ view }
			fields={ fields }
			onCreated={ onCreated }
			disabled={ disabled }
			presentation="grid-card"
		/>
	);

	if ( gridElement ) {
		return createPortal( newRowCard, gridElement );
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
