import { createAuthPlugin } from "@agent-native/core/server";

/**
 * The root path is the app's session list, not a public marketing surface, so
 * the plugin configures the auth guard only.
 */
export default createAuthPlugin({});
