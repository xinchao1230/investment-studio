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
      // ResearchPage installs a capture-phase listener that calls
      // `stopImmediatePropagation()` when it claims the event (file lives
      // under a research target, or under the currently-selected target).
      // We listen in the bubble phase so that:
      //   - When ResearchPage claims, this handler is never reached.
      //   - When ResearchPage declines (no target context), the event
      //     bubbles up here and we open the inline preview as fallback.
      // The defensive `_inlineHandled` check protects against listener-
      // registration-order surprises in tests.
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