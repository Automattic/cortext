import { useEntityRecords } from '@wordpress/core-data';
import { useMemo } from '@wordpress/element';

import { ACTIVE_PAGES_QUERY, POST_TYPE } from '../components/page-queries';
import { firstPageInTree } from '../components/pages-tree';
import { computeDocumentUri } from '../router/useResolveEntity';
import { useWorkspaceHome } from './useWorkspaceHome';

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
		ACTIVE_PAGES_QUERY
	);
	const pages = useMemo( () => records ?? [], [ records ] );
	const fallbackHomePage = useMemo(
		() => firstPageInTree( pages ),
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
