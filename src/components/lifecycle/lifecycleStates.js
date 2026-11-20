import { __ } from '@wordpress/i18n';
import { box as archiveIcon, trash as trashIcon } from '@wordpress/icons';

import ArchivedTrashConfirmDialog from './ArchivedTrashConfirmDialog';
import EmptyTrashButton from './EmptyTrashButton';
import TrashConfirmDialog from './TrashConfirmDialog';
import { archivedLabel, deletionLabel } from './lifecycleItems';
import useArchivedDocuments from '../../hooks/useArchivedDocuments';
import useTrashedDocuments from '../../hooks/useTrashedDocuments';
import {
	archivedUri,
	isArchivedUri,
	isTrashUri,
	trashUri,
} from '../../router/useResolveEntity';

/**
 * What a lifecycle view needs to know about its state. The views, the canvas
 * notice and the empty pane read everything state-specific from here.
 *
 * - `restore` and `secondary` pick the action from `useDocumentActions()`.
 * - `SecondaryConfirmDialog` confirms `secondary` with
 *   `{ record, counts, onConfirm, onCancel }`.
 * - `secondaryRemovesDocument` says whether the document is gone afterwards,
 *   so a canvas showing it from outside the view has to leave.
 * - `copy()` returns the strings, translated at call time.
 */
export const TRASH = {
	name: 'trash',
	icon: trashIcon,
	uri: trashUri,
	isUri: isTrashUri,
	useDocuments: useTrashedDocuments,
	// Mirror the PHP `TrashCascade` markers. The cascade stamps a different
	// key depending on whether the descendant was trashed as a child page or
	// as a row of a collection, but either one points back to the cascade
	// root.
	markerKeys: [
		'_cortext_trashed_by_parent',
		'_cortext_trashed_by_collection',
	],
	byKey: 'trashed_by',
	atKey: 'trashed_at',
	statusLabel: deletionLabel,
	noticeStatus: 'warning',
	restore: ( actions ) => actions.restore,
	secondary: ( actions ) => actions.permanentDelete,
	SecondaryConfirmDialog: TrashConfirmDialog,
	secondaryRemovesDocument: true,
	HeaderAction: EmptyTrashButton,
	copy: () => ( {
		title: __( 'Trash', 'cortext' ),
		listLabel: __( 'Items in Trash', 'cortext' ),
		searchLabel: __( 'Search Trash', 'cortext' ),
		loadError: __( 'Could not load Trash.', 'cortext' ),
		emptyList: __( 'Trash is empty.', 'cortext' ),
		primaryShortcut: __( 'restore', 'cortext' ),
		secondaryShortcut: __( 'delete', 'cortext' ),
		secondaryLabel: __( 'Delete permanently', 'cortext' ),
		restoreError: __( 'Could not restore this document.', 'cortext' ),
		secondaryError: __( 'Could not delete this document.', 'cortext' ),
		noticeTitle: __( 'This document is in Trash.', 'cortext' ),
		emptyTitle: __( 'Nothing in Trash', 'cortext' ),
		emptyBody: __(
			'Documents you move to Trash show up here with where they came from. They stay for 30 days, then they are deleted for good.',
			'cortext'
		),
	} ),
};

export const ARCHIVED = {
	name: 'archived',
	icon: archiveIcon,
	uri: archivedUri,
	isUri: isArchivedUri,
	useDocuments: useArchivedDocuments,
	// Mirror the PHP `ArchiveCascade` markers, the same way as Trash.
	markerKeys: [
		'_cortext_archived_by_parent',
		'_cortext_archived_by_collection',
	],
	byKey: 'archived_by',
	atKey: 'archived_at',
	statusLabel: archivedLabel,
	noticeStatus: 'info',
	restore: ( actions ) => actions.unarchive,
	secondary: ( actions ) => actions.trash,
	SecondaryConfirmDialog: ArchivedTrashConfirmDialog,
	secondaryRemovesDocument: false,
	HeaderAction: null,
	copy: () => ( {
		title: __( 'Archived', 'cortext' ),
		listLabel: __( 'Archived items', 'cortext' ),
		searchLabel: __( 'Search Archived', 'cortext' ),
		loadError: __( 'Could not load archived documents.', 'cortext' ),
		emptyList: __( 'No archived documents.', 'cortext' ),
		primaryShortcut: __( 'restore', 'cortext' ),
		secondaryShortcut: __( 'trash', 'cortext' ),
		secondaryLabel: __( 'Move to Trash', 'cortext' ),
		restoreError: __( 'Could not restore this document.', 'cortext' ),
		secondaryError: __(
			'Could not move this document to Trash.',
			'cortext'
		),
		noticeTitle: __(
			'This document is archived and read only.',
			'cortext'
		),
		emptyTitle: __( 'Nothing archived', 'cortext' ),
		emptyBody: __(
			'Documents you archive show up here with where they came from. They stay out of the sidebar and search until you restore them.',
			'cortext'
		),
	} ),
};
