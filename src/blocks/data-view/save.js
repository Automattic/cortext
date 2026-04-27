// Dynamic block: frontend rendering is deferred to Phase 2. Keeping save
// flat means the block comment in post_content stays self-describing
// (`<!-- wp:cortext/data-view {"collectionId":N} /-->`) instead of carrying
// stale cached HTML.
export default function save() {
	return null;
}
