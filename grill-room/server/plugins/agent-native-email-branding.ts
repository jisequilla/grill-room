import { defineAppConfig } from "@agent-native/core/server";

export default defineAppConfig({
  app: {
    // This name appears in transactional emails. Change it to your product name.
    name: "Grill Room",
    // The source template keeps a renamed app from inheriting first-party email branding.
    sourceTemplate: "chat",
    // The session list is the app's landing page.
    homePath: "/",
    // Optional: use your own absolute HTTPS logo URL in transactional emails.
    // logoUrl: "https://example.com/logo.png",
  },
});
