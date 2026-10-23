import { useCallback, useEffect, useRef, useState } from "react";
import { buildSuggestionRequest } from "../lib/suggestion-request";

const SUGGESTION_DEBOUNCE_MS = 600;
const CONTEXT_PREFIX_LENGTH = 64;

interface AISuggestionsStates {
  suggestion: string | null;
  isLoading: boolean;
  position: { line: number; column: number } | null;
  suggestionFileId: string | null;
  decoration: string[];
  isEnabled: boolean;
}

interface UseAISuggestionsReturn extends AISuggestionsStates {
  toggleEnabled: (value?: boolean) => void;
  fetchSuggestion: (type: string, editor: any) => Promise<void>;
  acceptSuggestion: (editor: any, monaco: any) => void;
  rejectSuggestion: (editor: any) => void;
  clearSuggestion: (editor: any) => void;
}

type EditorContext = {
  lineNumber: number;
  column: number;
  prefix: string;
  fileContent: string;
  cursorLine: number;
  cursorColumn: number;
};

type SuggestionContext = {
  fileId: string | null;
  lineNumber: number;
  column: number;
  prefix: string;
};

function readEditorContext(editor: any): EditorContext | null {
  if (!editor) return null;

  const model = editor.getModel?.();
  const position = editor.getPosition?.();
  if (!model || !position) return null;

  const fileContent = model.getValue();
  const offset = model.getOffsetAt(position);

  return {
    lineNumber: position.lineNumber,
    column: position.column,
    prefix: fileContent.slice(Math.max(0, offset - CONTEXT_PREFIX_LENGTH), offset),
    fileContent,
    cursorLine: position.lineNumber - 1,
    cursorColumn: position.column - 1,
  };
}

function isSameEditorContext(
  editor: any,
  expected: EditorContext,
  requestFileId: string | null,
  currentFileId: string | null,
): boolean {
  if (requestFileId !== currentFileId) return false;

  const current = readEditorContext(editor);
  if (!current) return false;

  return (
    current.lineNumber === expected.lineNumber &&
    current.column === expected.column &&
    current.prefix === expected.prefix
  );
}

export const useAISuggestions = (
  activeFileId: string | null,
  activeFileName: string | null = null,
): UseAISuggestionsReturn => {
  const [state, setState] = useState<AISuggestionsStates>({
    suggestion: null,
    isLoading: false,
    position: null,
    suggestionFileId: null,
    decoration: [],
    isEnabled: false,
  });

  const requestIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const enabledRef = useRef(false);
  const fileIdRef = useRef<string | null>(activeFileId);
  const fileNameRef = useRef<string | null>(activeFileName);
  const suggestionRef = useRef<string | null>(null);
  const suggestionMetaRef = useRef<SuggestionContext | null>(null);
  const decorationRef = useRef<string[]>([]);

  enabledRef.current = state.isEnabled;
  fileNameRef.current = activeFileName;
  suggestionRef.current = state.suggestion;
  decorationRef.current = state.decoration;

  const stopActiveRequest = useCallback(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    abortRef.current?.abort();
    abortRef.current = null;
    requestIdRef.current += 1;
  }, []);

  // useEffect runs after paint, and after Monaco's child effect has already
  // swapped the model. Cancel here so a File A response cannot commit on File B.
  if (fileIdRef.current !== activeFileId) {
    fileIdRef.current = activeFileId;
    stopActiveRequest();
    suggestionRef.current = null;
    suggestionMetaRef.current = null;

    if (
      state.suggestion !== null ||
      state.position !== null ||
      state.suggestionFileId !== null ||
      state.isLoading ||
      state.decoration.length > 0
    ) {
      setState((prev) => ({
        ...prev,
        suggestion: null,
        position: null,
        suggestionFileId: null,
        decoration: [],
        isLoading: false,
      }));
    }
  }

  const clearStoredSuggestion = useCallback((editor?: any) => {
    stopActiveRequest();
    suggestionRef.current = null;
    suggestionMetaRef.current = null;

    if (editor && decorationRef.current.length > 0) {
      editor.deltaDecorations(decorationRef.current, []);
    }

    setState((prev) => ({
      ...prev,
      suggestion: null,
      position: null,
      suggestionFileId: null,
      decoration: [],
      isLoading: false,
    }));
  }, [stopActiveRequest]);

  useEffect(() => {
    // The model swap can emit a cursor event after the render-time cancel.
    // Cancel once more so that event cannot start a request.
    clearStoredSuggestion();
  }, [activeFileId, clearStoredSuggestion]);

  const toggleEnabled = useCallback(
    (value?: boolean) => {
      const next = typeof value === "boolean" ? value : !enabledRef.current;
      enabledRef.current = next;

      if (!next) {
        stopActiveRequest();
        suggestionRef.current = null;
        suggestionMetaRef.current = null;
        setState((prev) => ({
          ...prev,
          isEnabled: false,
          suggestion: null,
          position: null,
          suggestionFileId: null,
          decoration: [],
          isLoading: false,
        }));
        return;
      }

      setState((prev) => ({ ...prev, isEnabled: true }));
    },
    [stopActiveRequest],
  );

  const requestSuggestion = useCallback(
    async (type: string, editor: any, requestId: number) => {
      const fileId = fileIdRef.current;
      if (requestId !== requestIdRef.current || !enabledRef.current) return;

      const context = readEditorContext(editor);
      if (!context) return;
      if (fileIdRef.current !== fileId) return;

      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setState((prev) =>
        requestId === requestIdRef.current && fileIdRef.current === fileId
          ? { ...prev, isLoading: true }
          : prev,
      );

      try {
        const response = await fetch("/api/code-suggestion", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(
            buildSuggestionRequest({
              fileContent: context.fileContent,
              cursorLine: context.cursorLine,
              cursorColumn: context.cursorColumn,
              suggestionType: type,
              fileName: fileNameRef.current,
            }),
          ),
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`API responded with status ${response.status}`);
        }

        const data = await response.json();
        const stillCurrent = () =>
          requestId === requestIdRef.current &&
          fileIdRef.current === fileId &&
          enabledRef.current;

        if (!stillCurrent()) return;
        if (!isSameEditorContext(editor, context, fileId, fileIdRef.current)) {
          setState((prev) =>
            requestId === requestIdRef.current && fileIdRef.current === fileId
              ? { ...prev, isLoading: false }
              : prev,
          );
          return;
        }

        const suggestionText =
          typeof data.suggestion === "string" ? data.suggestion.trim() : "";
        if (!suggestionText) {
          console.warn("No suggestion received from API");
          setState((prev) =>
            requestId === requestIdRef.current && fileIdRef.current === fileId
              ? { ...prev, isLoading: false }
              : prev,
          );
          return;
        }

        setState((prev) => {
          if (
            requestId !== requestIdRef.current ||
            fileIdRef.current !== fileId ||
            !enabledRef.current
          ) {
            return prev;
          }

          suggestionRef.current = suggestionText;
          suggestionMetaRef.current = {
            fileId,
            lineNumber: context.lineNumber,
            column: context.column,
            prefix: context.prefix,
          };

          return {
            ...prev,
            suggestion: suggestionText,
            position: {
              line: context.lineNumber,
              column: context.column,
            },
            suggestionFileId: fileId,
            isLoading: false,
          };
        });
      } catch (error) {
        if ((error as Error).name === "AbortError") return;

        console.error("Error fetching code suggestion:", error);
        setState((prev) =>
          requestId === requestIdRef.current && fileIdRef.current === fileId
            ? { ...prev, isLoading: false }
            : prev,
        );
      }
    },
    [],
  );

  const fetchSuggestion = useCallback(
    async (type: string, editor: any) => {
      if (!enabledRef.current) return;

      const context = readEditorContext(editor);
      if (!context) {
        console.warn("Editor instance is not available");
        return;
      }

      const visible = suggestionMetaRef.current;
      const sameSpot =
        visible !== null &&
        visible.fileId === fileIdRef.current &&
        visible.lineNumber === context.lineNumber &&
        visible.column === context.column &&
        visible.prefix === context.prefix &&
        suggestionRef.current !== null;

      if (sameSpot) return;

      stopActiveRequest();
      const requestId = requestIdRef.current;
      const originFileId = fileIdRef.current;
      const originContext = context;
      suggestionRef.current = null;
      suggestionMetaRef.current = null;
      setState((prev) =>
        prev.suggestion === null &&
        prev.position === null &&
        prev.suggestionFileId === null &&
        !prev.isLoading
          ? prev
          : {
              ...prev,
              suggestion: null,
              position: null,
              suggestionFileId: null,
              isLoading: false,
            },
      );

      debounceRef.current = setTimeout(() => {
        debounceRef.current = null;
        if (requestId !== requestIdRef.current || !enabledRef.current) return;
        if (fileIdRef.current !== originFileId) return;
        if (
          !isSameEditorContext(
            editor,
            originContext,
            originFileId,
            fileIdRef.current,
          )
        ) {
          return;
        }
        void requestSuggestion(type, editor, requestId);
      }, SUGGESTION_DEBOUNCE_MS);
    },
    [requestSuggestion, stopActiveRequest],
  );

  const acceptSuggestion = useCallback(
    (editor: any, _monaco: any) => {
      // The editor inserts the text once. This only drops the stored ghost
      // so the same suggestion cannot be shown again after the file updates.
      clearStoredSuggestion(editor);
    },
    [clearStoredSuggestion],
  );

  const rejectSuggestion = useCallback(
    (editor: any) => {
      clearStoredSuggestion(editor);
    },
    [clearStoredSuggestion],
  );

  const clearSuggestion = useCallback(
    (editor: any) => {
      clearStoredSuggestion(editor);
    },
    [clearStoredSuggestion],
  );

  useEffect(() => {
    return () => {
      stopActiveRequest();
    };
  }, [stopActiveRequest]);

  return {
    ...state,
    toggleEnabled,
    fetchSuggestion,
    acceptSuggestion,
    rejectSuggestion,
    clearSuggestion,
  };
};
