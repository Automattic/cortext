import { __, sprintf } from '@wordpress/i18n';
import { Button } from '@wordpress/components';

export default function SidebarSection( {
	id,
	title,
	isCollapsed,
	onToggle,
	actions = null,
	children,
} ) {
	const bodyId = `cortext-sidebar-section-${ id }`;
	const isExpanded = ! isCollapsed;
	const label = isCollapsed
		? sprintf(
				/* translators: %s: sidebar section title */
				__( 'Expand %s', 'cortext' ),
				title
		  )
		: sprintf(
				/* translators: %s: sidebar section title */
				__( 'Collapse %s', 'cortext' ),
				title
		  );

	return (
		<section
			className={ `cortext-sidebar__section cortext-sidebar__section--${ id }` }
			data-sidebar-section={ id }
			data-section-collapsed={ isCollapsed ? 'true' : 'false' }
		>
			<div className="cortext-sidebar__section-header">
				<h2 className="cortext-sidebar__section-title">
					<Button
						className="cortext-sidebar__section-title-button"
						size="small"
						variant="tertiary"
						label={ label }
						aria-expanded={ isExpanded }
						aria-controls={ bodyId }
						onClick={ onToggle }
					>
						{ title }
					</Button>
				</h2>
				{ actions ? (
					<div className="cortext-sidebar__section-actions">
						{ actions }
					</div>
				) : null }
			</div>
			<div
				className={
					'cortext-sidebar__section-body-wrapper' +
					( isExpanded ? ' is-expanded' : '' )
				}
				aria-hidden={ isCollapsed ? 'true' : undefined }
				{ ...( isCollapsed ? { inert: '' } : {} ) }
			>
				<div id={ bodyId } className="cortext-sidebar__section-body">
					{ children }
				</div>
			</div>
		</section>
	);
}
