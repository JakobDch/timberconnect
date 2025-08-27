const env = process.env;

module.exports = {
  uiHost: env.NR_UI_HOST || "0.0.0.0",
  httpAdminRoot: env.NR_ADMIN_ROOT || "/",
  httpNodeRoot: env.NR_NODE_ROOT || "/",
};