import { memo, useEffect } from "react";
import { InlinePreviewAtom } from "./chat-side.atom";
import InlineFilePreviewPanel from "./InlineFilePreviewPanel";
import SchedulesSidepane from "./SchedulesSidepane";
import SubAgentTasksSidepane from "./SubAgentTasksSidepane";
import WorkspaceExplorerSidepane from "./workspace/WorkspaceExplorerSidepane";


function ChatSide(props: {
  onSelectScheduledSession?: (sessionId: string) => void | Promise<void>;
}) {
  const [inlinePreview, previewActions] = InlinePreviewAtom.use();

  useEffect(() => {
    (window as any).__inlineFilePreviewEnabled = true;

    const handleFileViewerOpen = (event: Event) => {
      // When Research Assistant workspace mode is mounted, the middle
      // ContentTabs pane is the single source of truth for previewing
      // files clicked from the embedded chat. Defer unconditionally so
      // the user never sees a stray right-column inline preview while
      // workspace mode is the active surface — this is more robust than
      // relying on capture-vs-bubble event ordering, which can race when
      // listeners register in unexpected order.
      if ((window as any).__researchTabOpenEnabled) return;
      if ((event as any)._inlineHandled) return;

      const customEvent = event as CustomEvent;
      const { file } = customEvent.detail || {};
      if (file && file.name && file.url) {
        (customEvent as any)._inlineHandled = true;
        customEvent.preventDefault?.();
        customEvent.stopImmediatePropagation?.();
        previewActions.open(file);
      }
    };
    window.addEventListener('fileViewer:open', handleFileViewerOpen, false);
    return () => {
      (window as any).__inlineFilePreviewEnabled = false;
      window.removeEventListener('fileViewer:open', handleFileViewerOpen, false);
    };
  }, []);

  if (inlinePreview) {
    const { file, width } = inlinePreview;
    return (
      <>
        <div
          className="inline-preview-resizer"
          onMouseDown={previewActions.resize}
        />
        <InlineFilePreviewPanel
          file={file}
          isOpen
          onClose={previewActions.cancel}
          onDirtyStateChange={previewActions.markDirty}
          style={width != undefined ? { flex: `0 0 ${width}px` } : undefined}
        />
      </>
    )
  }

  return (
    <>
      <SubAgentTasksSidepane />
      <SchedulesSidepane onSelectSession={props.onSelectScheduledSession} />
      {/* Workspace Explorer Sidepane */}
      <WorkspaceExplorerSidepane />
    </>
  );
}


export default memo(ChatSide);