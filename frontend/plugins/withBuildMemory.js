const { withGradleProperties } = require("expo/config-plugins");

module.exports = function withBuildMemory(config) {
  return withGradleProperties(config, (mod) => {
    const values = {
      "org.gradle.jvmargs": "-Xmx4g -XX:MaxMetaspaceSize=1g",
      "org.gradle.workers.max": "2",
    };
    mod.modResults = mod.modResults.filter(
      (entry) => entry.type !== "property" || !(entry.key in values),
    );
    for (const [key, value] of Object.entries(values)) {
      mod.modResults.push({ type: "property", key, value });
    }
    return mod;
  });
};
