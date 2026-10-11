const { withAndroidManifest, withInfoPlist } = require("expo/config-plugins");

// This local-first development app supports user-configured LAN HTTP endpoints.
module.exports = function withLocalApi(config) {
  config = withAndroidManifest(config, (mod) => {
    mod.modResults.manifest.application[0].$["android:usesCleartextTraffic"] = "true";
    return mod;
  });
  return withInfoPlist(config, (mod) => {
    mod.modResults.NSAppTransportSecurity = {
      ...mod.modResults.NSAppTransportSecurity,
      NSAllowsLocalNetworking: true,
    };
    mod.modResults.NSLocalNetworkUsageDescription = "Connect to your CalcMate server on the local network.";
    return mod;
  });
};
