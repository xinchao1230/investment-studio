const path = require('path');
const fs = require('fs');

// 1. Determine Brand Name
// Priority: BRAND (env var) > npm_config_brand (npm CLI: --brand=xxx, set in .npmrc, etc.) > 'openkosmos'
//
// Notes:
//   - npm exposes any `npm config` value (or `--brand=xxx` CLI flag, or `brand=xxx`
//     line in .npmrc) as the env var `npm_config_brand`. This works cross-platform
//     (Windows pwsh, cmd, bash, zsh) without needing shell variable expansion in
//     package.json scripts.
//   - The previous `cross-env BRAND=$npm_config_brand` indirection in npm scripts
//     did NOT work on Windows because neither cmd.exe nor pwsh expands `$VAR`
//     using POSIX shell rules; we now read npm_config_brand directly here.
const brandName = process.env.BRAND || process.env.npm_config_brand || 'openkosmos';

const repoRoot = path.resolve(__dirname, '..');
const brandDir = path.join(repoRoot, 'brands', brandName);
const assetsDir = path.join(brandDir, 'assets');
const configFile = path.join(brandDir, 'config.json');

// 2. Validate validity
if (!fs.existsSync(configFile)) {
  console.error(`[BrandConfig] Error: Configuration for brand "${brandName}" not found at ${configFile}`);
  process.exit(1);
}

// 3. Load Configuration
const config = require(configFile);

console.log(`[BrandConfig] Active Brand: ${brandName}`);
console.log(`[BrandConfig] Product Name: ${config.productName}`);

module.exports = {
  name: brandName,
  config: config,
  paths: {
    root: brandDir,
    assets: assetsDir,
    // Icons
    iconMac: path.join(assetsDir, 'mac/app.icns'),
    iconWin: path.join(assetsDir, 'win/app.ico'),
    
    // Asset Directories (for generation scripts)
    assetsMac: path.join(assetsDir, 'mac'),
    assetsWin: path.join(assetsDir, 'win'),
  }
};
