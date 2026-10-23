export interface ProjectSwitchPatch {
  playgroundId: string;
  templateData: null;
  openFiles: [];
  activeFileId: null;
  editorContent: "";
}

/** Returns the editor state to clear when the route opens a different project. */
export function projectSwitchPatch(
  currentId: string,
  nextId: string,
): ProjectSwitchPatch | null {
  if (nextId.length === 0 || currentId === nextId) {
    return null;
  }

  return {
    playgroundId: nextId,
    templateData: null,
    openFiles: [],
    activeFileId: null,
    editorContent: "",
  };
}

/**
 * The loaded tree replaces the explorer tree only for the project currently
 * on the route, and only while that project has no open tabs.
 */
export function shouldApplyLoadedTree(input: {
  routeId: string;
  storeId: string;
  openFileCount: number;
  hasTree: boolean;
}): boolean {
  return (
    input.hasTree &&
    input.routeId.length > 0 &&
    input.storeId === input.routeId &&
    input.openFileCount === 0
  );
}
