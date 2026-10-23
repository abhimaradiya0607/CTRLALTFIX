import type {
  TemplateFolder,
  TemplateItem,
} from "@/features/playground/lib/path-to-json";
  
  interface WebContainerFile {
    file: {
      contents: string;
    };
  }
  
  interface WebContainerDirectory {
    directory: {
      [key: string]: WebContainerFile | WebContainerDirectory;
    };
  }
  
  type WebContainerFileSystem = Record<string, WebContainerFile | WebContainerDirectory>;
  
function isFolder(item: TemplateItem): item is TemplateFolder {
  return "folderName" in item && "items" in item && Boolean(item.folderName) && Boolean(item.items);
}

function itemKey(item: TemplateItem): string {
  if ("fileExtension" in item && item.fileExtension) {
    return `${item.filename}.${item.fileExtension}`;
  }
  if ("folderName" in item) {
    return item.folderName;
  }
  return item.filename;
}

export function transformToWebContainerFormat(template: TemplateFolder): WebContainerFileSystem {
  function processItem(item: TemplateItem): WebContainerFile | WebContainerDirectory {
    if (isFolder(item)) {
      const directoryContents: WebContainerFileSystem = {};

      item.items.forEach((subItem) => {
        directoryContents[itemKey(subItem)] = processItem(subItem);
      });

      return {
        directory: directoryContents,
      };
    }

    return {
      file: {
        contents: item.content,
      },
    };
  }

  const result: WebContainerFileSystem = {};

  template.items.forEach((item) => {
    result[itemKey(item)] = processItem(item);
  });

  return result;
}