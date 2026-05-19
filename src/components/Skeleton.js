/**
 * Small skeleton primitives shared by loading states across Cortext.
 *
 * The goal is to reserve the same space the real content will occupy so
 * that when data arrives there's no layout shift. All primitives render
 * an `aria-hidden` element with a low-cost opacity pulse that respects
 * `prefers-reduced-motion`.
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

// A horizontal bar; defaults to the title/label size. Width can be tuned
// per use to vary the rhythm of stacked lines.
export function SkeletonLine( { className, ...rest } ) {
	return (
		<SkeletonBlock
			className={ joinClassName( 'cortext-skeleton--line', className ) }
			{ ...rest }
		/>
	);
}

// Label + value pair used wherever a list of properties is rendered while
// loading (row peek, full-page document, inspector sidebars).
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

// Sidebar list rows (Favorites, Trash, etc.) while the underlying entity
// records resolve. The width pattern keeps the rows from looking like a
// uniform stack of identical bars.
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

// Roughly table-shaped rows shown while useCollectionRows fetches the
// first page. Sized so the canvas pane stays the same height as it will
// be once rows arrive, instead of growing from zero. Density mirrors
// DataViews v6 row heights (compact 40px / balanced 64px / comfortable
// 72px); the row count is capped because perPage of 25+ would paint a
// skeleton longer than the viewport for no extra value.
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

// Thin indeterminate progress bar shown at the top of the canvas while
// the entity route resolves and the editor mounts. Honest about the
// uncertainty — a canvas document can be a page, a row, a fresh blank,
// with or without cover and icon, so a skeleton that mimics one shape
// inevitably misleads for the others. The bar just signals "working on
// it" without promising structure.
export function CanvasProgressBar( { className } ) {
	return (
		<div
			className={ joinClassName( 'cortext-canvas-progress', className ) }
			aria-hidden="true"
		/>
	);
}
