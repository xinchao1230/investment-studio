import { BRAND_NAME } from '@shared/constants/branding';

// Static brand icon imports — both webpack (`require`) and vite (ESM) resolve these
// at build time to a hashed URL string. Listing each brand explicitly keeps the
// bundler graph static and avoids `import.meta.glob` / runtime `require` differences.
import openkosmosIcon from '../assets/openkosmos/app.svg';
import investmentStudioIcon from '../assets/investment-studio/app.svg';

const brandIcons: Record<string, string> = {
  'openkosmos': openkosmosIcon,
  'investment-studio': investmentStudioIcon,
};

export const appIcon: string = brandIcons[BRAND_NAME] || brandIcons['openkosmos'] || '';
