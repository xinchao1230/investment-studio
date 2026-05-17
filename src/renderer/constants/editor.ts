/**
 * Editor-wide constants.
 *
 * Centralized so the OverlayFileViewer modal, the in-page ContentTabs
 * editor, and any future inline editing surface all share the same
 * limits. Bumping a value here updates the entire app.
 */

/**
 * Hard cap on the file size we'll load into an interactive Monaco
 * editor. Above this, the editor falls back to a read-only preview
 * with a banner explaining why.
 *
 * Why 5 MB: Monaco's tokenizer + diff calculations get noticeably
 * janky above a few megabytes of text, and the IPC payload also has
 * to traverse the structured-clone boundary. Production code reviews
 * almost never warrant editing anything larger by hand — those should
 * go through MCP tools or external editors.
 */
export const MAX_EDIT_SIZE_BYTES = 5 * 1024 * 1024;
