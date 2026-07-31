import { useEntityRecords } from '@wordpress/core-data';
import { useMemo } from '@wordpress/element';

import { POST_TYPE } from '../components/page-queries';
import { firstDocumentInTree } from '../components/document-tree';
import { computeDocumentUri } from '../router/useResolveEntity';
import { useWorkspaceHome } from './useWorkspaceHome';

// Only the first root document is needed as a home fallback when no explicit
// home is set, so this stays a single-record request rather than loading the
// whole tree. It mirrors the sidebar tree's root query so the fallback matches
// the first row the sidebar shows.
const HOME_FALLBACK_QUERY = {
	parent: 0,
	per_page: 1,
	status: [ 'draft', 'private', 'publish' ],
	context: 'edit',
	cortext_no_trait: 1,
	cortext_tree_order: 1,
	orderby: 'menu_order',
	order: 'asc',
};

export function useWorkspaceHomePath() {
	const {
		home,
		setHome,
		isResolving: isResolvingHome,
		isUpdating,
		error,
	} = useWorkspaceHome();
	const { records, isResolving: isResolvingPages } = useEntityRecords(
		'postType',
		POST_TYPE,
		HOME_FALLBACK_QUERY
	);
	const pages = useMemo( () => records ?? [], [ records ] );
	const fallbackHomePage = useMemo(
		() => firstDocumentInTree( pages ),
		[ pages ]
	);
	const homePath =
		home?.path ??
		( fallbackHomePage ? computeDocumentUri( fallbackHomePage ) : null );
	const isResolvingHomePath =
		isResolvingHome || ( ! home?.path && isResolvingPages );

	return {
		home,
		homePath,
		pages,
		setHome,
		isResolvingHome,
		isResolvingHomePath,
		isResolvingPages,
		isUpdating,
		error,
	};
}
