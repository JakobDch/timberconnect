const env = process.env;

module.exports = {
  uiHost: env.NR_UI_HOST || "0.0.0.0",
  httpAdminRoot: env.NR_ADMIN_ROOT || "/",
  httpNodeRoot: env.NR_NODE_ROOT || "/",
  adminAuth: {
    type: "credentials",
    users: [{
      username: "solid-dataspace",
      password: "$2y$08$.odZfecYCfsKeIZ.TNmQbes8hXU95PfjheTpYBs6EiMnEkPo5wz/O",
      permissions: "*"
    }]
  }
};