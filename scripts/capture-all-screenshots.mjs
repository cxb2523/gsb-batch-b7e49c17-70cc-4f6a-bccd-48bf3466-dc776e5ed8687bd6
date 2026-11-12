import pkg from '../frontend/node_modules/@playwright/test/index.js';
const { chromium } = pkg;
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

// Generate timestamp string YYYY-MM-DD_HH-mm-ss
const now = new Date();
const pad = (n) => String(n).padStart(2, '0');
const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`;
const outputDir = path.join(ROOT_DIR, 'local', `screenshot-${timestamp}`);

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

console.log(`[Screenshot Suite] Output directory: ${outputDir}`);

const BASE_URL = 'http://localhost:5173';
const API_BASE = 'http://localhost:3000';
const PASSPHRASE = 'CanvHQ2026!';

async function main() {
  const browser = await chromium.launch({
    headless: true,
  });

  const VIEWPORT = { width: 1440, height: 900 };
  const DEVICE_SCALE = 2; // Retina 2x for crisp, ultra-high-res screenshots

  async function capture(page, filename, description) {
    const filePath = path.join(outputDir, filename);
    console.log(`📸 Capturing [${filename}]: ${description}...`);
    await page.waitForLoadState('networkidle').catch(() => {});
    await page.waitForTimeout(1000);
    await page.screenshot({ path: filePath, fullPage: true });
    console.log(`   -> Saved to ${filePath}`);
  }

  // ==========================================
  // PHASE 1: Public & Unauthenticated Pages
  // ==========================================
  console.log('\n--- PHASE 1: Public & Unauthenticated Pages ---');
  const publicContext = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const publicPage = await publicContext.newPage();

  // 1. Landing Page
  await publicPage.goto(`${BASE_URL}/`, { waitUntil: 'networkidle' });
  await capture(publicPage, '01-landing.png', 'Landing Page (Full Length)');

  // 2. Login Page
  await publicPage.goto(`${BASE_URL}/login`, { waitUntil: 'networkidle' });
  await capture(publicPage, '02-login.png', 'Login Page with OAuth & Dev Options');

  // 3. Terms of Service
  await publicPage.goto(`${BASE_URL}/terms`, { waitUntil: 'networkidle' });
  await capture(publicPage, '03-terms.png', 'Terms of Service Page');

  // 4. Security & Cryptography
  await publicPage.goto(`${BASE_URL}/security`, { waitUntil: 'networkidle' });
  await capture(publicPage, '04-security.png', 'Security Specifications & Zero-Knowledge Architecture');

  // 5. Privacy Policy
  await publicPage.goto(`${BASE_URL}/privacy`, { waitUntil: 'networkidle' });
  await capture(publicPage, '05-privacy.png', 'Privacy Policy & GDPR Disclosure');

  // 6. Documentation Pages
  const docPages = [
    { slug: 'architecture', file: '06-docs-architecture.png', label: 'Docs - Zero-Knowledge Architecture' },
    { slug: 'coolify', file: '07-docs-coolify.png', label: 'Docs - Turnkey Coolify Deployment' },
    { slug: 'docker-compose', file: '08-docs-docker-compose.png', label: 'Docs - Production Docker Compose' },
    { slug: 'digitalocean', file: '09-docs-digitalocean.png', label: 'Docs - Standalone VPS Deployment' },
    { slug: 'cloud-storage', file: '10-docs-cloud-storage.png', label: 'Docs - Cloud Storage Setup (R2/S3)' },
    { slug: 'environment-variables', file: '11-docs-env-vars.png', label: 'Docs - Environment Variables Reference' },
    { slug: 'backup-recovery', file: '12-docs-backup-recovery.png', label: 'Docs - Backup & Disaster Recovery' },
  ];

  for (const doc of docPages) {
    await publicPage.goto(`${BASE_URL}/docs/${doc.slug}`, { waitUntil: 'networkidle' });
    await capture(publicPage, doc.file, doc.label);
  }

  // 13. Sample Invite Acceptance Page
  await publicPage.goto(`${BASE_URL}/invite/sample-invite-preview`, { waitUntil: 'networkidle' });
  await capture(publicPage, '13-invite-accept.png', 'Workspace Invite Acceptance Flow');

  // ==========================================
  // PHASE 2: Authenticated Workspace Pages
  // ==========================================
  console.log('\n--- PHASE 2: Authenticated Workspace Pages ---');
  const authContext = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: DEVICE_SCALE,
    permissions: ['clipboard-read', 'clipboard-write'],
  });
  const authPage = await authContext.newPage();

  // Log in using Dev Login endpoint to acquire session cookie
  console.log('🔑 Authenticating via Dev Login for q@local.com...');
  const loginRes = await authPage.request.post(`${API_BASE}/api/auth/dev-login`, {
    data: { email: 'q@local.com', name: 'Qarib' },
  });
  console.log(`   Dev login HTTP status: ${loginRes.status()}`);

  // Navigate to workspace to check encryption modal status
  await authPage.goto(`${BASE_URL}/workspace`, { waitUntil: 'networkidle' });
  await authPage.waitForTimeout(1500);

  // Check if E2EE Setup or Unlock modal is displayed
  const modalHeading = authPage.locator('h2:has-text("Passphrase"), h2:has-text("Unlock Your Diagrams"), h2:has-text("Set Your Diagram Passphrase")');
  if (await modalHeading.count() > 0) {
    const headingText = await modalHeading.first().innerText();
    console.log(`🔒 E2EE Modal detected: "${headingText}"`);

    if (headingText.includes('Set')) {
      await capture(authPage, '14-e2ee-passphrase-setup-modal.png', 'Zero-Knowledge E2EE Passphrase Setup Dialog');
      // Fill in Setup form
      const passphraseInput = authPage.locator('input[type="password"]').first();
      const confirmInput = authPage.locator('input[type="password"]').nth(1);
      await passphraseInput.fill(PASSPHRASE);
      await confirmInput.fill(PASSPHRASE);
      const submitBtn = authPage.getByRole('button', { name: /Set Passphrase & Continue/i });
      await submitBtn.click();
      console.log('   Passphrase set! Waiting for modal dismissal...');
      await authPage.waitForSelector('h2:has-text("Set Your Diagram Passphrase")', { state: 'detached', timeout: 10000 }).catch(() => {});
    } else if (headingText.includes('Unlock')) {
      await capture(authPage, '14-e2ee-passphrase-unlock-modal.png', 'Zero-Knowledge E2EE Unlock Modal');
      const passphraseInput = authPage.locator('input[type="password"]').first();
      await passphraseInput.fill(PASSPHRASE);
      const unlockBtn = authPage.getByRole('button', { name: /Unlock Diagrams/i });
      await unlockBtn.click();
      console.log('   Unlock clicked! Waiting for modal dismissal...');
      await authPage.waitForSelector('h2:has-text("Unlock Your Diagrams")', { state: 'detached', timeout: 10000 }).catch(() => {});
    }
  }

  // 15. Create Workspace Onboarding
  await authPage.goto(`${BASE_URL}/create-workspace`, { waitUntil: 'networkidle' });
  await capture(authPage, '15-create-workspace.png', 'Workspace Onboarding & Creation Form');

  // 16. Workspace Dashboard
  await authPage.goto(`${BASE_URL}/workspace`, { waitUntil: 'networkidle' });
  const workspaceUrl = authPage.url();
  console.log(`   Navigated to workspace URL: ${workspaceUrl}`);
  await capture(authPage, '16-workspace-dashboard.png', 'Workspace Dashboard with Projects & Canvases Grid');

  // 17. Workspace Management
  const slugMatch = workspaceUrl.match(/\/w\/([^/?#]+)/);
  const activeSlug = slugMatch ? slugMatch[1] : 'general';
  await authPage.goto(`${BASE_URL}/w/${activeSlug}/management`, { waitUntil: 'networkidle' });
  await capture(authPage, '17-workspace-management.png', 'Workspace Management (Projects, RBAC, Members, Danger Zone)');

  // 18. User Profile & Settings
  await authPage.goto(`${BASE_URL}/profile`, { waitUntil: 'networkidle' });
  await capture(authPage, '18-profile-settings.png', 'User Profile Settings & GDPR Data Export');

  // 19. Canvas Editor
  await authPage.goto(`${BASE_URL}/w/${activeSlug}`, { waitUntil: 'networkidle' });
  await authPage.waitForTimeout(1000);

  // Check if a canvas card exists, or click "Create a canvas"
  let canvasCard = authPage.locator('a[href*="/canvas/"], a[href*="/board/"]').first();
  if (await canvasCard.count() === 0) {
    console.log('   Creating new canvas via starter card...');
    const createBtn = authPage.getByText(/Create a canvas/i).first();
    if (await createBtn.count() > 0) {
      await createBtn.click();
      await authPage.waitForURL(/.*\/(canvas|board)\/.*/, { timeout: 10000 }).catch(() => {});
    }
  } else {
    console.log('   Opening existing canvas card...');
    await canvasCard.click();
    await authPage.waitForURL(/.*\/(canvas|board)\/.*/, { timeout: 10000 }).catch(() => {});
  }

  const editorUrl = authPage.url();
  console.log(`   Canvas Editor URL: ${editorUrl}`);
  // Wait for Excalidraw canvas to mount
  await authPage.waitForSelector('.excalidraw', { timeout: 15000 }).catch(() => {});
  await authPage.waitForTimeout(2000);
  await capture(authPage, '19-canvas-editor.png', 'Spatial Excalidraw Canvas Editor View');

  // 20. Canvas Share Popover
  const shareBtn = authPage.getByRole('button', { name: /^Share$/i }).first();
  let publicShareUrl = null;
  if (await shareBtn.count() > 0) {
    console.log('   Opening Share menu popover...');
    await shareBtn.click();
    await authPage.waitForTimeout(600);
    await capture(authPage, '20-canvas-share-menu.png', 'Canvas Share Popover with Public Toggle & Collaborators');

    // Enable public link if not already enabled
    const publicSwitch = authPage.getByRole('switch').first();
    if (await publicSwitch.count() > 0) {
      const isChecked = await publicSwitch.getAttribute('aria-checked');
      if (isChecked !== 'true') {
        console.log('   Toggling public share switch ON...');
        await publicSwitch.click();
        await authPage.waitForTimeout(1500);
      }
      
      const copyBtn = authPage.getByRole('button', { name: /Copy Public Link/i });
      if (await copyBtn.count() > 0) {
        await copyBtn.click();
        publicShareUrl = await authPage.evaluate(() => navigator.clipboard.readText()).catch(() => null);
      }
    }
    await shareBtn.click().catch(() => {});
  }

  // 21. Mermaid Importer Modal
  const mermaidBtn = authPage.getByRole('button', { name: /Import Mermaid/i }).first();
  if (await mermaidBtn.count() > 0) {
    console.log('   Opening Mermaid Importer modal...');
    await mermaidBtn.click();
    await authPage.waitForSelector('text=IMPORT MERMAID TO CANVAS', { timeout: 5000 }).catch(() => {});
    await authPage.waitForTimeout(600);
    await capture(authPage, '21-canvas-mermaid-modal.png', 'Mermaid Diagram to Vector Canvas Importer Modal');
    const closeBtn = authPage.locator('button:has-text("✕"), button:has-text("Cancel"), button[title="Close"]').first();
    await closeBtn.click().catch(() => {});
  }

  // ==========================================
  // PHASE 3: Public Canvas Read-Only Views
  // ==========================================
  console.log('\n--- PHASE 3: Public Shared Canvas Views ---');
  if (publicShareUrl && publicShareUrl.includes('/share/')) {
    console.log(`   Testing public share URL: ${publicShareUrl}`);
    // 22. Public Read-Only Canvas with Hash Key
    await publicPage.goto(publicShareUrl, { waitUntil: 'networkidle' });
    await publicPage.waitForSelector('.excalidraw', { timeout: 15000 }).catch(() => {});
    await publicPage.waitForTimeout(2000);
    await capture(publicPage, '22-public-canvas-view.png', 'Public Read-Only Canvas (Decrypted via URL Hash Key)');

    // 23. Public Canvas without Hash Key (Prompts for Decryption Key)
    const urlWithoutHash = publicShareUrl.split('#')[0];
    await publicPage.goto(urlWithoutHash, { waitUntil: 'networkidle' });
    await publicPage.waitForTimeout(1000);
    await capture(publicPage, '23-public-canvas-key-prompt.png', 'Public Canvas with Missing Key (Zero-Knowledge Decryption Prompt)');
  } else {
    console.log('   Navigating to public share token view...');
    await publicPage.goto(`${BASE_URL}/share/demo-token`, { waitUntil: 'networkidle' });
    await capture(publicPage, '22-public-canvas-key-prompt.png', 'Public Canvas Decryption Key Dialog');
  }

  await browser.close();

  // Generate an index manifest in the screenshots folder
  const files = fs.readdirSync(outputDir).filter(f => f.endsWith('.png')).sort();
  const manifest = {
    capturedAt: now.toISOString(),
    totalScreenshots: files.length,
    viewport: `${VIEWPORT.width}x${VIEWPORT.height} @2x (Retina)`,
    screenshots: files.map(file => ({
      file,
      path: path.join(outputDir, file)
    }))
  };

  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify(manifest, null, 2));

  console.log(`\n🎉 [Completed] Successfully captured ${files.length} full-length screenshots!`);
  console.log(`📁 Files located at: ${outputDir}`);
}

main().catch(err => {
  console.error('[Error during screenshot capture]:', err);
  process.exit(1);
});
