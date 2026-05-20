/**
 * Small skeleton pieces shared by Cortext loading states.
 *
 * They reserve the space the real content will use, so data arriving later
 * does not shove the layout around. Each primitive is `aria-hidden` and uses
 * a light opacity pulse that respects `prefers-reduced-motion`.
 */

function toLength( value ) {
	if ( value === undefined || value === null ) {
		return undefined;
	}
	return typeof value === 'number' ? `${ value }px` : value;
}

function joinClassName( ...parts ) {
	return parts.filter( Boolean ).join( ' ' );
}

export function SkeletonBlock( {
	className,
	width,
	height,
	style,
	as: Tag = 'span',
	...rest
} ) {
	const finalStyle = { ...( style ?? {} ) };
	const w = toLength( width );
	const h = toLength( height );
	if ( w !== undefined ) {
		finalStyle.width = w;
	}
	if ( h !== undefined ) {
		finalStyle.height = h;
	}
	return (
		<Tag
			className={ joinClassName( 'cortext-skeleton', className ) }
			style={ finalStyle }
			aria-hidden="true"
			{ ...rest }
		/>
	);
}

// A horizontal bar. Callers can pass a width so stacked lines do not all look
// identical.
export function SkeletonLine( { className, ...rest } ) {
	return (
		<SkeletonBlock
			className={ joinClassName( 'cortext-skeleton--line', className ) }
			{ ...rest }
		/>
	);
}

// Label and value placeholders for property lists while they load.
export function SkeletonFieldRow( { valueWidth, className } ) {
	return (
		<div
			className={ joinClassName( 'cortext-skeleton-field', className ) }
			aria-hidden="true"
		>
			<SkeletonLine className="cortext-skeleton-field__label" />
			<SkeletonLine
				className="cortext-skeleton-field__value"
				width={ valueWidth }
			/>
		</div>
	);
}

// Sidebar rows for Favorites, Trash, and similar lists. The width pattern keeps
// the placeholder labels from lining up like identical bars.
const SIDEBAR_SKELETON_WIDTHS = [ '72%', '58%', '84%', '46%', '68%', '52%' ];

export function SidebarListSkeleton( { itemCount = 5 } ) {
	return (
		<div className="cortext-sidebar-skeleton" aria-hidden="true">
			{ Array.from( { length: itemCount } ).map( ( _, idx ) => (
				<div key={ idx } className="cortext-sidebar-skeleton__row">
					<SkeletonBlock className="cortext-sidebar-skeleton__icon" />
					<SkeletonLine
						className="cortext-sidebar-skeleton__label"
						width={
							SIDEBAR_SKELETON_WIDTHS[
								idx % SIDEBAR_SKELETON_WIDTHS.length
							]
						}
					/>
				</div>
			) ) }
		</div>
	);
}

// tech-debt.md#54: mirror DataViews row heights so the loading table does not
// jump when real rows arrive. Cap the row count so perPage=25 does not draw
// past the viewport.
const COLLECTION_SKELETON_ROW_CAP = 15;

export function CollectionRowsSkeleton( {
	rowCount = 8,
	columnCount = 4,
	density = 'compact',
} ) {
	const safeColumns = Math.max( 1, columnCount );
	const safeRows = Math.max(
		1,
		Math.min( rowCount, COLLECTION_SKELETON_ROW_CAP )
	);
	return (
		<div
			className={ joinClassName(
				'cortext-collection-skeleton',
				`cortext-collection-skeleton--${ density }`
			) }
			aria-hidden="true"
		>
			{ Array.from( { length: safeRows } ).map( ( _, rowIndex ) => (
				<div
					key={ rowIndex }
					className="cortext-collection-skeleton__row"
				>
					{ Array.from( { length: safeColumns } ).map(
						( __, colIndex ) => (
							<SkeletonLine
								key={ colIndex }
								className={ joinClassName(
									'cortext-collection-skeleton__cell',
									colIndex === 0
										? 'cortext-collection-skeleton__cell--first'
										: null
								) }
							/>
						)
					) }
				</div>
			) ) }
		</div>
	);
}

// Thin progress bar for route and editor loads. A document can be a page, row,
// or blank draft, with or without cover and icon; a shaped skeleton would be
// wrong often enough to be distracting.
export function CanvasProgressBar( { className } ) {
	return (
		<div
			className={ joinClassName( 'cortext-canvas-progress', className ) }
			aria-hidden="true"
		/>
	);
}
