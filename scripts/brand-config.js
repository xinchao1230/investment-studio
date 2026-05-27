const path = require('path');
const fs = require('fs');

const brandName = process.env.BRAND || process.env.npm_config_brand || 'openkosmos';

const repoRoot = path.resolve(__dirname, '..');
const brandDir = path.join(repoRoot, 'brands', brandName);
const assetsDir = path.join(brandDir, 'assets');
const configFile = path.join(brandDir, 'config.json');

if (!fs.existsSync(configFile)) {
  console.error(`[BrandConfig] Error: Configuration for brand "${brandName}" not found at ${configFile}`);
  process.exit(1);
}

const config = require(configFile);

console.log(`[BrandConfig] Active Brand: ${brandName}`);
console.log(`[BrandConfig] Product Name: ${config.productName}`);

module.exports = {
  name: brandName,
  config: config,
  paths: {
    root: brandDir,
    assets: assetsDir,
    iconMac: path.join(assetsDir, 'mac/app.icns'),
    iconWin: path.join(assetsDir, 'win/app.ico'),
    assetsMac: path.join(assetsDir, 'mac'),
    assetsWin: path.join(assetsDir, 'win'),
  }
};
