export const PI_DATA_REFRESH_EVENT = "dts:pi-data-updated";
export const PI_DATA_REFRESH_STORAGE_KEY = "dts:pi-data-updated:v1";

/** Notify open report/workbench tabs after a committed PI price correction. */
export function notifyPiDataUpdated() {
  window.dispatchEvent(new Event(PI_DATA_REFRESH_EVENT));
  try { window.localStorage.setItem(PI_DATA_REFRESH_STORAGE_KEY, String(Date.now())); }
  catch { /* The current tab still receives the event when storage is unavailable. */ }
}
