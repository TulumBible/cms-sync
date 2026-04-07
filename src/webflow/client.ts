import { WebflowClient } from "webflow-api";

export function createWebflowClient(): WebflowClient {
  const accessToken = process.env.WEBFLOW_API_TOKEN;
  if (!accessToken) {
    throw new Error("WEBFLOW_API_TOKEN environment variable is not set");
  }
  return new WebflowClient({ accessToken });
}

export function getSiteId(): string {
  const siteId = process.env.WEBFLOW_SITE_ID;
  if (!siteId) {
    throw new Error("WEBFLOW_SITE_ID environment variable is not set");
  }
  return siteId;
}
