// Browser-side entry points mentioned by support reports.
export const uploadEndpoint = "/v1/uploads";
export const loginEndpoint = "/v1/session";
export const invoiceEndpoint = "/v1/invoices";

export function renderExportState(state) {
  return state === "ready" ? "Download" : "Preparing";
}

export function browserFamily(userAgent) {
  return /Safari/i.test(userAgent) ? "safari" : "other";
}
