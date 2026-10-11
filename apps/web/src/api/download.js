import { apiClient } from "./client";

// Authenticated file download: a plain <a href> to the API sends no Bearer
// token (401), so fetch the file as a Blob through apiClient and hand the
// browser a temporary object URL to save.
export async function downloadFile(url, fallbackName, config = {}) {
  const res = await apiClient.get(url, { ...config, responseType: "blob" });
  const disposition = res.headers?.["content-disposition"] || "";
  const match = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(disposition);
  const filename = match ? decodeURIComponent(match[1]) : fallbackName;
  const objectUrl = URL.createObjectURL(res.data);
  const link = document.createElement("a");
  link.href = objectUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
  return filename;
}
