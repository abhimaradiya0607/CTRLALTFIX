export function nextPreviewVisible(visible: boolean): boolean {
  return !visible;
}

export function previewMenuLabel(visible: boolean): "Hide Preview" | "Show Preview" {
  return visible ? "Hide Preview" : "Show Preview";
}
