export interface TemplateFile {
    filename: string
    fileExtension: string
    content: string
  }
  

  export interface TemplateFolder {
    folderName: string
    items: (TemplateFile | TemplateFolder)[]
  }

export interface PlaygroundData {
    id: string
    name?: string | null
    [key: string]: any
  }

  export interface LoadingStepProps{
    currentStep: number
    steps: number,
    label: string
  }
