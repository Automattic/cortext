// Cortext's own document glyphs, drawn to sit at the same visual weight as the
// WordPress document outline in the sidebar. `collectionIcon` is a rounded table
// with the same ~14-wide extent as the page glyph, so a collection row lines up
// with a page row instead of reading bigger or heavier.

export const collectionIcon = (
	<svg
		xmlns="http://www.w3.org/2000/svg"
		viewBox="0 0 24 24"
		width="24"
		height="24"
		aria-hidden="true"
		focusable="false"
	>
		<rect
			x="5"
			y="6"
			width="14"
			height="12"
			rx="1.8"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.45"
		/>
		<path
			d="M5 10h14M9.5 6v12M14.5 6v12"
			fill="none"
			stroke="currentColor"
			strokeWidth="1.35"
			strokeLinecap="round"
		/>
	</svg>
);

// Cortext glyphs addressable by name, the same way DocumentIcon resolves a
// `{ type: 'wp', name }` meta against @wordpress/icons. Lets a collection render
// its own glyph through DocumentIcon (same scale and box as every other row)
// instead of needing a special render path.
export const CORTEXT_GLYPHS = {
	collection: collectionIcon,
};
