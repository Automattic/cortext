import { __, _n, sprintf } from '@wordpress/i18n';
import { Dropdown, MenuGroup, MenuItem } from '@wordpress/components';
import { Fragment } from '@wordpress/element';
import { Icon, check, chevronDown } from '@wordpress/icons';

import './Breadcrumbs.scss';

import useBreadcrumbSegments from '../hooks/useBreadcrumbSegments';
import { useFrozenDetails } from '../documents/readOnlyStore';
import FrozenBadge from './FrozenBadge';
import DocumentIcon from './DocumentIcon';
import { collectionIcon } from './cortextIcons';

// Truncate once the bar would carry more than this many segments. A
// four-deep page hierarchy fits unchanged; anything beyond collapses the
// middle into "first / … / parent / current".
const MAX_SEGMENTS = 4;

// Collapses [root, a, b, c, ..., last] down to [root, …, parent, last] when the
// chain gets too long. The ellipsis is non-interactive (no popover in this
// pass) — the issue only asks for overflow protection.
function truncate( segments ) {
	if ( segments.length <= MAX_SEGMENTS ) {
		return segments;
	}
	const first = segments[ 0 ];
	const tail = segments.slice( -2 );
	return [
		first,
		{
			key: 'ellipsis',
			label: '…',
			onClick: null,
			isCurrent: false,
			isEllipsis: true,
		},
		...tail,
	];
}

// Lists every collection the row belongs to. Picking one reopens the row from
// that collection, which moves it into the breadcrumb.
function CollectionMenu( { collections, renderToggle } ) {
	return (
		<Dropdown
			popoverProps={ { placement: 'bottom-start' } }
			renderToggle={ renderToggle }
			renderContent={ ( { onClose } ) => (
				<MenuGroup label={ __( 'Open from', 'cortext' ) }>
					{ collections.map( ( collection ) => (
						<MenuItem
							key={ collection.key }
							icon={
								collection.icon ? (
									<DocumentIcon
										icon={ collection.icon }
										size={ 20 }
									/>
								) : (
									collectionIcon
								)
							}
							iconPosition="left"
							role="menuitemradio"
							isSelected={ collection.isCurrent }
							suffix={
								collection.isCurrent ? (
									<Icon icon={ check } size={ 20 } />
								) : null
							}
							onClick={ () => {
								onClose();
								if ( ! collection.isCurrent ) {
									collection.onClick();
								}
							} }
						>
							{ collection.label }
						</MenuItem>
					) ) }
				</MenuGroup>
			) }
		/>
	);
}

function Segment( { segment } ) {
	if ( segment.isEllipsis ) {
		return (
			<span className="cortext-breadcrumbs__ellipsis" aria-hidden="true">
				{ segment.label }
			</span>
		);
	}

	if ( segment.isCurrent || ! segment.onClick ) {
		return (
			<span
				className="cortext-breadcrumbs__segment is-current"
				aria-current={ segment.isCurrent ? 'page' : undefined }
			>
				{ segment.label }
			</span>
		);
	}

	return (
		<button
			type="button"
			className="cortext-breadcrumbs__segment"
			onClick={ segment.onClick }
		>
			{ segment.label }
		</button>
	);
}

export default function Breadcrumbs( { paintedDocumentId } ) {
	const { segments: rawSegments, collections } =
		useBreadcrumbSegments( paintedDocumentId );
	const segments = truncate( rawSegments );
	const frozen = useFrozenDetails( paintedDocumentId );
	if ( segments.length === 0 ) {
		return null;
	}

	const hasContextCollection = segments.some(
		( segment ) => segment.isContextCollection
	);

	return (
		<nav
			className="cortext-breadcrumbs"
			aria-label={ __( 'Breadcrumb', 'cortext' ) }
		>
			<ol className="cortext-breadcrumbs__list">
				{ segments.map( ( segment, index ) => (
					<Fragment key={ segment.key }>
						{ index > 0 && (
							<li
								className="cortext-breadcrumbs__separator"
								aria-hidden="true"
							>
								/
							</li>
						) }
						<li className="cortext-breadcrumbs__item">
							<Segment segment={ segment } />
							{ segment.isContextCollection ? (
								<CollectionMenu
									collections={ collections }
									renderToggle={ ( { isOpen, onToggle } ) => (
										<button
											type="button"
											className="cortext-breadcrumbs__switch"
											onClick={ onToggle }
											aria-expanded={ isOpen }
											aria-label={ sprintf(
												/* translators: %d: number of other collections. */
												_n(
													'Also in %d other collection',
													'Also in %d other collections',
													collections.length - 1,
													'cortext'
												),
												collections.length - 1
											) }
										>
											<span className="cortext-breadcrumbs__count">
												{ `+${
													collections.length - 1
												}` }
											</span>
											<Icon
												icon={ chevronDown }
												size={ 16 }
											/>
										</button>
									) }
								/>
							) : null }
						</li>
					</Fragment>
				) ) }
			</ol>
			{ collections.length > 1 && ! hasContextCollection ? (
				<CollectionMenu
					collections={ collections }
					renderToggle={ ( { isOpen, onToggle } ) => (
						<button
							type="button"
							className="cortext-breadcrumbs__locations"
							onClick={ onToggle }
							aria-expanded={ isOpen }
						>
							<Icon icon={ collectionIcon } size={ 16 } />
							{ sprintf(
								/* translators: %d: number of collections. */
								_n(
									'In %d collection',
									'In %d collections',
									collections.length,
									'cortext'
								),
								collections.length
							) }
							<Icon icon={ chevronDown } size={ 16 } />
						</button>
					) }
				/>
			) : null }
			<FrozenBadge frozen={ frozen } showLabel />
		</nav>
	);
}
