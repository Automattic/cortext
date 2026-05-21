/**
 * Row defaults for shared document hooks. Rows are leaves and do not have a
 * normal sidebar row yet. Restore and permanent delete still live in
 * `SidebarTrash` for now.
 */
const rowDescriptor = {
	features: {
		hierarchy: false,
		canCreateChild: false,
		hasOwnIcon: false,
	},

	// Row rename lives in the row editor. Duplicate and trash come from the
	// DataView, so the sidebar does not expose those actions here.
};

export default rowDescriptor;
