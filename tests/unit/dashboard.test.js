const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');

const webDir = path.join(__dirname, '../../apps/web');

describe('Next.js Dashboard', () => {
  it('should have package.json with Next.js dependency', () => {
    const pkgPath = path.join(webDir, 'package.json');
    assert.ok(fs.existsSync(pkgPath), 'package.json exists');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
    assert.ok(pkg.dependencies.next, 'Next.js in dependencies');
    assert.ok(pkg.dependencies.react, 'React in dependencies');
    assert.ok(pkg.dependencies.tailwindcss, 'Tailwind in dependencies');
  });

  it('should have tsconfig.json', () => {
    const tsconfigPath = path.join(webDir, 'tsconfig.json');
    assert.ok(fs.existsSync(tsconfigPath), 'tsconfig.json exists');
    const tsconfig = JSON.parse(fs.readFileSync(tsconfigPath, 'utf8'));
    assert.ok(tsconfig.compilerOptions.jsx, 'JSX configured');
  });

  it('should have tailwind config', () => {
    const tailwindPath = path.join(webDir, 'tailwind.config.js');
    assert.ok(fs.existsSync(tailwindPath), 'tailwind.config.js exists');
  });

  it('should have global CSS with theme variables', () => {
    const cssPath = path.join(webDir, 'src/app/globals.css');
    assert.ok(fs.existsSync(cssPath), 'globals.css exists');
    const css = fs.readFileSync(cssPath, 'utf8');
    assert.ok(css.includes('--background'), 'background variable');
    assert.ok(css.includes('.dark'), 'dark mode class');
  });

  it('should have layout with providers', () => {
    const layoutPath = path.join(webDir, 'src/app/layout.tsx');
    assert.ok(fs.existsSync(layoutPath), 'layout.tsx exists');
    const layout = fs.readFileSync(layoutPath, 'utf8');
    assert.ok(layout.includes('ThemeProvider'), 'ThemeProvider in layout');
    assert.ok(layout.includes('AuthProvider'), 'AuthProvider in layout');
    assert.ok(layout.includes('AuthGuard'), 'AuthGuard in layout');
  });

  it('should have all required pages', () => {
    const pages = [
      'src/app/page.tsx',
      'src/app/login/page.tsx',
      'src/app/agents/page.tsx',
      'src/app/analytics/page.tsx',
      'src/app/settings/page.tsx',
      'src/app/team/page.tsx',
    ];

    for (const page of pages) {
      const pagePath = path.join(webDir, page);
      assert.ok(fs.existsSync(pagePath), `${page} exists`);
    }
  });

  it('should have auth provider with context', () => {
    const authPath = path.join(webDir, 'src/components/providers/AuthProvider.tsx');
    assert.ok(fs.existsSync(authPath), 'AuthProvider exists');
    const content = fs.readFileSync(authPath, 'utf8');
    assert.ok(content.includes('useAuth'), 'useAuth hook exported');
    assert.ok(content.includes('login'), 'login function');
    assert.ok(content.includes('logout'), 'logout function');
  });

  it('should have theme provider with dark mode', () => {
    const themePath = path.join(webDir, 'src/components/providers/ThemeProvider.tsx');
    assert.ok(fs.existsSync(themePath), 'ThemeProvider exists');
    const content = fs.readFileSync(themePath, 'utf8');
    assert.ok(content.includes('dark'), 'dark mode support');
    assert.ok(content.includes('useTheme'), 'useTheme hook exported');
  });

  it('should have API client', () => {
    const apiPath = path.join(webDir, 'src/lib/api.ts');
    assert.ok(fs.existsSync(apiPath), 'api.ts exists');
    const content = fs.readFileSync(apiPath, 'utf8');
    assert.ok(content.includes('getAgents'), 'getAgents function');
    assert.ok(content.includes('getAnalytics'), 'getAnalytics function');
  });
});
