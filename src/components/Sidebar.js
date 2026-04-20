import { __ } from '@wordpress/i18n';
import { useEntityRecords } from '@wordpress/core-data';
import { useDispatch } from '@wordpress/data';
import { Button, Spinner } from '@wordpress/components';

// Stand-in until the `cortext_page` CPT lands — change this constant to swap.
const POST_TYPE = 'page';

export default function Sidebar( { selectedId, onSelect } ) {
	const { records, isResolving } = useEntityRecords( 'postType', POST_TYPE, {
		per_page: 100,
		status: [ 'private', 'publish' ],
	} );
	const { saveEntityRecord } = useDispatch( 'core' );
	const pages = records ?? [];

	async function createPage() {
		const created = await saveEntityRecord( 'postType', POST_TYPE, {
			status: 'private',
			title: __( 'Untitled', 'cortext' ),
		} );
		if ( created?.id ) {
			onSelect( created.id );
		}
	}

	return (
		<aside className="cortext-sidebar">
			<div className="cortext-sidebar__header">
				<Button
					icon="arrow-left-alt2"
					label={ __( 'Back to WordPress', 'cortext' ) }
					href="index.php"
				/>
				<Button variant="primary" onClick={ createPage }>
					{ __( 'New page', 'cortext' ) }
				</Button>
			</div>
			{ isResolving && (
				<div className="cortext-sidebar__loading">
					<Spinner />
				</div>
			) }
			{ ! isResolving && pages.length === 0 && (
				<p className="cortext-sidebar__empty">
					{ __( 'No pages yet.', 'cortext' ) }
				</p>
			) }
			<ul className="cortext-sidebar__list">
				{ pages.map( ( page ) => (
					<li key={ page.id }>
						<Button
							isPressed={ page.id === selectedId }
							onClick={ () => onSelect( page.id ) }
						>
							{ page.title?.rendered ||
								__( '(untitled)', 'cortext' ) }
						</Button>
					</li>
				) ) }
			</ul>
		</aside>
	);
}
