const expoConfig = require("eslint-config-expo/flat");
const { defineConfig } = require("eslint/config");

module.exports = defineConfig([
  expoConfig,
  {
    settings: { "import/resolver": "node" },
    rules: {
      "import/namespace": "off",
      "import/default": "off",
      "import/no-unresolved": "off",
      "import/no-duplicates": "off",
      "react/display-name": "off"
    }
  }
]);
