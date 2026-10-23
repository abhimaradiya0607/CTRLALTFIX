"use client";

import React, { useRef, useEffect, useLayoutEffect, useCallback } from "react";
import Editor, { type Monaco } from "@monaco-editor/react";
import {
  getEditorLanguage,
  configureMonaco,
  defaultEditorOptions,
} from "../lib/editor-config";

interface EditorActiveFile {
  id?: string;
  fileExtension?: string;
}

interface PlaygroundEditorProps {
  activeFile: EditorActiveFile | undefined;
  content: string;
  onContentChange: (value: string) => void;
  aiEnabled: boolean;
  suggestion: string | null;
  suggestionLoading: boolean;
  suggestionPosition: { line: number; column: number } | null;
  suggestionFileId: string | null;
  onAcceptSuggestion: (editor: any, monaco: any) => void;
  onRejectSuggestion: (editor: any) => void;
  onTriggerSuggestion: (type: string, editor: any) => void;
}

const PlaygroundEditor = ({
  activeFile,
  content,
  onContentChange,
  aiEnabled,
  suggestion,
  suggestionLoading,
  suggestionPosition,
  suggestionFileId,
  onAcceptSuggestion,
  onRejectSuggestion,
  onTriggerSuggestion,
}: PlaygroundEditorProps) => {
  const editorRef = useRef<any>(null);
  const monacoRef = useRef<Monaco | null>(null);

  const inlineCompletionProviderRef = useRef<any>(null);
  const currentSuggestionRef = useRef<{
    text: string;
    id: string;
  } | null>(null);

  const isAcceptingSuggestionRef = useRef(false);
  const suggestionAcceptedRef = useRef(false);
  const tabCommandRef = useRef<{ dispose: () => void } | null>(null);
  const aiEnabledRef = useRef(aiEnabled);
  const suggestionTextRef = useRef(suggestion);
  const suggestionPositionRef = useRef(suggestionPosition);
  const suggestionFileIdRef = useRef(suggestionFileId);
  const activeFileIdRef = useRef<string | null>(activeFile?.id ?? null);
  const triggerRef = useRef(onTriggerSuggestion);
  const acceptRef = useRef(onAcceptSuggestion);
  const rejectRef = useRef(onRejectSuggestion);
  const trackedFileIdRef = useRef<string | null>(activeFile?.id ?? null);
  const suppressModelTriggerRef = useRef(false);

  aiEnabledRef.current = aiEnabled;
  suggestionTextRef.current = suggestion;
  suggestionPositionRef.current = suggestionPosition;
  suggestionFileIdRef.current = suggestionFileId;
  activeFileIdRef.current = activeFile?.id ?? null;
  triggerRef.current = onTriggerSuggestion;
  acceptRef.current = onAcceptSuggestion;
  rejectRef.current = onRejectSuggestion;

  const activeFileId = activeFile?.id ?? null;
  const fileExtension = activeFile?.fileExtension || "";

  if (trackedFileIdRef.current !== activeFileId) {
    trackedFileIdRef.current = activeFileId;
    suppressModelTriggerRef.current = true;
    currentSuggestionRef.current = null;
  }


  
  
  const generateSuggestionId = () =>
    `suggestion-${Date.now()}-${Math.random()}`;

  const createInlineCompletionProvider = useCallback((monaco: Monaco) => {
    return {
      provideInlineCompletions: () => {
        if (suppressModelTriggerRef.current) return { items: [] };

        const text = suggestionTextRef.current;
        const expected = suggestionPositionRef.current;
        const position = editorRef.current?.getPosition();
        const fileId = activeFileIdRef.current;
        const ownsFile =
          fileId !== null && suggestionFileIdRef.current === fileId;

        if (
          !aiEnabledRef.current ||
          !text ||
          !ownsFile ||
          !expected ||
          !position ||
          position.lineNumber !== expected.line ||
          position.column !== expected.column ||
          isAcceptingSuggestionRef.current ||
          suggestionAcceptedRef.current
        ) {
          return { items: [] };
        }

        const suggestionId = generateSuggestionId();
        currentSuggestionRef.current = {
          text,
          id: suggestionId,
        };

        const cleanedSuggestion = text.replace(/\r/g, "");

        return {
          items: [
            {
              insertText: cleanedSuggestion,
              range: new monaco.Range(
                expected.line,
                expected.column,
                expected.line,
                expected.column,
              ),
              kind: monaco.languages.CompletionItemKind.Text,
              label: `AI Suggestion`,
              detail: `AI Generated Code Suggestion `,
              documentation: `Press tab to accept`,
              filterText: "",
              sortText: "0000",
              insertTextRules:
                monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
            },
          ],
        };
      },
      disposeInlineCompletions: () => {},
    };
  }, []);

  //clear current suggestion

  const hideInlineSuggestion = useCallback(() => {
    currentSuggestionRef.current = null;

    if (editorRef.current) {
      editorRef.current.trigger(
        "ai",
        "editor.action.inlineSuggest.hide",
        null,
      );
    }
  }, []);

  const clearCurrentSuggestion = useCallback(() => {
    suggestionAcceptedRef.current = false;
    hideInlineSuggestion();
  }, [hideInlineSuggestion]);

  //accept current suggestion with double acceptance prevetance
  const acceptCurrentSuggestion = useCallback(() => {
      if (
        !editorRef.current ||
        !monacoRef.current ||
        !currentSuggestionRef.current
      ) {
        console.log("Cannot accept suggestion: editor or monaco not ready");
        return false;
      }

      //critical :Prevent double acceptance with immediate flag setting
      if (isAcceptingSuggestionRef.current || suggestionAcceptedRef.current) {
        console.log("Blocked double acceptance attempt");
        return false;
      }

      isAcceptingSuggestionRef.current = true;
      suggestionAcceptedRef.current = true;

      

     

      try {
        const editor=editorRef.current;
        const monaco=monacoRef.current;
        const cleanedSuggestionText = currentSuggestionRef.current?.text.replace(/\r/g, "");
        const position = editor.getPosition();
        const expected = suggestionPositionRef.current;

        if (
          !position ||
          !expected ||
          position.lineNumber !== expected.line ||
          position.column !== expected.column
        ) {
          return false;
        }

        const range = new monaco.Range(
          position.lineNumber,
          position.column,
          position.lineNumber,
          position.column,
        );

        editor.executeEdits("ai-suggestion", [
          {
            range: range,
            text: cleanedSuggestionText,
            forceMoveMarkers: true,
          },
        ]);

        const lines = cleanedSuggestionText.split("\n");
        const endLine = position.lineNumber + lines.length - 1;

        const endColumn =
          lines.length == 1
            ? position.column + cleanedSuggestionText.length
            : lines[lines.length - 1].length + 1;

        editor.setPosition({ lineNumber: endLine, column: endColumn });

        // Clear the stored suggestion before the file update re-renders the editor.
        acceptRef.current(editor, monaco);
        hideInlineSuggestion();

        return true;
      } catch (error) {
        console.error("Error accepting suggestion:", error);
        return false;
      } finally {
        isAcceptingSuggestionRef.current = false;
        suggestionAcceptedRef.current = false;
      }
    }, [hideInlineSuggestion]);

  const hasActiveSuggestionAtPosition = useCallback(() => {
      if (!editorRef.current || !currentSuggestionRef.current) return false;

      const position = editorRef.current.getPosition();
      const expected = suggestionPositionRef.current;
      if (!position || !expected) return false;

      return (
        position.lineNumber === expected.line &&
        position.column >= expected.column &&
        position.column <= expected.column + 2
      );
    }, []);

  useEffect(() => {
    if (!editorRef.current || !monacoRef.current) return;

    if (inlineCompletionProviderRef.current) {
      inlineCompletionProviderRef.current.dispose();
      inlineCompletionProviderRef.current = null;
    }
    currentSuggestionRef.current = null;

    const canShow =
      aiEnabled &&
      Boolean(suggestion) &&
      suggestionFileId !== null &&
      activeFileId !== null &&
      suggestionFileId === activeFileId;

    if (!canShow) {
      editorRef.current.trigger("ai", "editor.action.inlineSuggest.hide", null);
      return;
    }

    const language = getEditorLanguage(fileExtension);
    const provider = createInlineCompletionProvider(monacoRef.current);
    inlineCompletionProviderRef.current =
      monacoRef.current.languages.registerInlineCompletionsProvider(
        language,
        provider,
      );

    const showTimer = setTimeout(() => {
      editorRef.current?.trigger(
        "ai",
        "editor.action.inlineSuggest.trigger",
        null,
      );
    }, 50);

    return () => {
      clearTimeout(showTimer);
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose();
        inlineCompletionProviderRef.current = null;
      }
    };
  }, [
    suggestion,
    suggestionFileId,
    aiEnabled,
    activeFileId,
    fileExtension,
    createInlineCompletionProvider,
  ]);

  const handleEditorDidMount = (editor: any, monaco: Monaco) => {
    editorRef.current = editor;
    monacoRef.current = monaco;

    editor.updateOptions({
      ...defaultEditorOptions,
      inlineSuggest: {
        enabled: true,
        model: "prefix",
        suppressSuggestion: true,
      },
      suggest: {
        preview: false,
        showInlineDetails: false,
        insertMode: "replace",
      },
      quickSuggestions: {
        other: true,
        comments: false,
        strings: false,
      },
      cursorSmoothAnimation: "on",
    });

    configureMonaco(monaco);

    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Space, () => {
      triggerRef.current("completion", editor);
    });

    if (tabCommandRef.current) {
      tabCommandRef.current.dispose();
    }

    tabCommandRef.current = editor.addAction({
      id: "accept-ai-suggestion",
      label: "Accept AI Suggestion",
      keybindings: [monaco.KeyCode.Tab],
      run: () => {
        if (isAcceptingSuggestionRef.current || suggestionAcceptedRef.current) {
          editor.trigger("keyboard","tab", null);
          return;
        }
        
        if(currentSuggestionRef.current) {
         const accepted = acceptCurrentSuggestion();
         if(accepted) {
          return;
         }
        }
        editor.trigger("keyboard","tab", null);
      },
    });

    editor.addCommand(monaco.KeyCode.Escape, () => {
      if (currentSuggestionRef.current || suggestionTextRef.current) {
        rejectRef.current(editor);
        clearCurrentSuggestion();
      }
    });

    editor.onDidChangeCursorPosition(() => {
      if (isAcceptingSuggestionRef.current || suppressModelTriggerRef.current) return;
      triggerRef.current("completion", editor);
    });

    editor.onDidChangeModelContent((e: any) => {
      if (isAcceptingSuggestionRef.current || suppressModelTriggerRef.current) return;

      // If user types while there's a suggestion, clear it (unless it's our insertion)
      if (
        currentSuggestionRef.current &&
        e.changes.length > 0 &&
        !suggestionAcceptedRef.current
      ) {
        const change = e.changes[0];

        if (
          change.text === currentSuggestionRef.current.text ||
          change.text === currentSuggestionRef.current.text.replace(/\r/g, "")
        ) {
          return;
        }

        clearCurrentSuggestion();
      }

      const triggers = ["\n", "{", ".", "=", "(", ",", ":", ";"];
      if (e.changes.length > 0 && triggers.includes(e.changes[0].text)) {
        triggerRef.current("completion", editor);
      }
    });

    updateEditorLanguage();
  };

  
  const updateEditorLanguage = () => {
    if (!activeFile || !editorRef.current || !monacoRef.current) return;
    
    const language = getEditorLanguage(activeFile.fileExtension || "");
    const model = editorRef.current.getModel();
    if (!model) return;
    try {
      monacoRef.current.editor.setModelLanguage(model, language);
    } catch (error) {
      console.warn("Failed to set language:", error);
    }
  };

  useLayoutEffect(() => {
    currentSuggestionRef.current = null;
    editorRef.current?.trigger("ai", "editor.action.inlineSuggest.hide", null);
  }, [activeFileId]);

  useEffect(() => {
    suppressModelTriggerRef.current = false;
  }, [activeFileId]);

  useEffect(() => {
    updateEditorLanguage();
  }, [activeFile]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (inlineCompletionProviderRef.current) {
        inlineCompletionProviderRef.current.dispose();
        inlineCompletionProviderRef.current = null;
      }
      if (tabCommandRef.current) {
        tabCommandRef.current.dispose();
        tabCommandRef.current = null;
      }
    };
  }, []);

  return (
    <div className="h-full position-relative">
      {/*todo:AI thinking bubble*/}
      {suggestionLoading && (
        <div
          className="absolute top-2 left-2 z-10 bg-red-100 dark:bg-red-900 px-2 py-1 rounded text-xs text-red-800 dark:text-red-300
          flex items-center gap-1"
        >
          <div className="size-2 bg-red-500 rounded-full animate-pulse"></div>
          AI Thinking...
        </div>
      )}

      {/*AI suggestion bubble*/}
      {currentSuggestionRef.current && !suggestionLoading && (
        <div
          className="absolute top-2 right-2 z-10 bg-green-100 dark:bg-green-900 px-2 py-1 rounded text-xs
         text-green-700 dark:text-green-300 flex items-center gap-1"
        >
          <div className="size-2 bg-green-500 rounded-full"></div>
          Press Tab to Accept
        </div>
      )}
      <Editor
        height="100%"
        value={content}
        onMount={handleEditorDidMount}
        onChange={(value) => onContentChange(value || "")} //@ts-ignore
        language={
          activeFile
            ? getEditorLanguage(activeFile.fileExtension || "")
            : "plaintext"
        }
        //@ts-ignore
        options={defaultEditorOptions}
      />
    </div>
  );
};

export default PlaygroundEditor;
