export type UiTheme = 'paper' | 'cinema' | 'neon' | 'arcade';

export interface UiThemeOption {
  key: UiTheme;
  name: string;
  en: string;
  description: string;
  color: string;
}

export const UI_THEMES: UiThemeOption[] = [
  { key: 'paper', name: '宣纸书卷', en: 'PAPER & INK', description: '默认。米白、朱红与宋体，安静耐看。', color: '#f4f0e8' },
  { key: 'cinema', name: '午夜影院', en: 'CINEMA NOIR', description: '深色画面、暖金控件和大幅主视觉。', color: '#0c0a09' },
  { key: 'neon', name: '流光', en: 'NEON STREAM', description: '侧边导航与霓虹渐变，更接近流媒体平台。', color: '#070a13' },
  { key: 'arcade', name: '像素放映厅', en: 'ARCADE', description: '街机边框、撞色阴影和像素进度。', color: '#14101f' }
];

const THEME_KEY = 'hongguo.uiTheme';
const THEME_COLORS: Record<UiTheme, string> = {
  paper: '#f4f0e8',
  cinema: '#0c0a09',
  neon: '#070a13',
  arcade: '#14101f'
};

export function isUiTheme(value: unknown): value is UiTheme {
  return UI_THEMES.some(theme => theme.key === value);
}

export function readUiTheme(storage?: Pick<Storage, 'getItem'>): UiTheme {
  try {
    const value = (storage ?? globalThis.localStorage).getItem(THEME_KEY);
    return isUiTheme(value) ? value : 'paper';
  } catch {
    return 'paper';
  }
}

export function saveUiTheme(value: UiTheme, storage?: Pick<Storage, 'setItem'>): boolean {
  if (!isUiTheme(value)) return false;
  try {
    (storage ?? globalThis.localStorage).setItem(THEME_KEY, value);
    return true;
  } catch {
    return false;
  }
}

export function applyUiTheme(value: UiTheme, root: HTMLElement = document.documentElement) {
  const theme = isUiTheme(value) ? value : 'paper';
  root.dataset.theme = theme;
  root.style.colorScheme = theme === 'paper' ? 'light' : 'dark';
  if (typeof document !== 'undefined') {
    const meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (meta) meta.content = THEME_COLORS[theme];
  }
}

export function themeOption(value: UiTheme): UiThemeOption {
  return UI_THEMES.find(theme => theme.key === value) ?? UI_THEMES[0];
}