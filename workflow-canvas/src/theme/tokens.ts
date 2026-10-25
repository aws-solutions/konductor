// SPDX-License-Identifier: Apache-2.0
import type { Theme } from '@cloudscape-design/components/theming';

/** The two looks of the page. */
export type ThemeMode = 'light' | 'dark';

/** The colours of one mode, named by what they are used for. */
export interface Colors {
  /** The page. */
  bg: string;
  /** The background of text boxes and other form controls. */
  field: string;
  /** Cards, panels and containers. */
  surface: string;
  /** Raised or secondary areas inside a surface. */
  surfaceAlt: string;
  /** Hairlines that divide areas. */
  border: string;
  /** The edge of a popup or a panel. */
  borderStrong: string;
  /** The edge of a control. It must reach 3:1 on the surface. */
  control: string;
  text: string;
  textMuted: string;
  /** Filled buttons and the selected segment. White text is set on it. */
  fill: string;
  fillHover: string;
  fillActive: string;
  /** Links and outlined buttons: text and edge in one colour. */
  link: string;
  linkHover: string;
  success: string;
  error: string;
  warning: string;
  /** The wash on a hovered or selected row, translucent. */
  tint: string;
  tintStrong: string;
  successBg: string;
  errorBg: string;
  warningBg: string;
  infoBg: string;
  overlay: string;
}

/** Light mode: the paper tones of the konductor docs theme. */
export const LIGHT: Colors = {
  bg: '#f5f3ee',
  field: '#ffffff',
  surface: '#ffffff',
  surfaceAlt: '#faf8f4',
  border: '#e0dad0',
  borderStrong: '#cfc7ba',
  control: '#7a7490',
  text: '#16131f',
  textMuted: '#56516a',
  fill: '#6236f0',
  fillHover: '#5128db',
  fillActive: '#4f26c9',
  link: '#6236f0',
  linkHover: '#4f26c9',
  success: '#0b7a52',
  error: '#b3261e',
  warning: '#8a5a00',
  tint: 'rgba(98, 54, 240, 0.08)',
  tintStrong: 'rgba(98, 54, 240, 0.16)',
  successBg: '#e7f5ee',
  errorBg: '#fdecec',
  warningBg: '#fff4db',
  infoBg: '#efebff',
  overlay: 'rgba(22, 19, 31, 0.45)',
};

/** Dark mode: the night tones of the konductor docs theme. */
export const DARK: Colors = {
  bg: '#0b0a12',
  field: '#100e1a',
  surface: '#171331',
  surfaceAlt: '#1c1740',
  border: '#2a2450',
  borderStrong: '#3a3168',
  control: '#8f86ad',
  text: '#f5f3ee',
  textMuted: '#9c93b8',
  fill: '#6b4bef',
  fillHover: '#5b3bdb',
  fillActive: '#4f2fc8',
  link: '#a78bfa',
  linkHover: '#c4b2ff',
  success: '#3ddc97',
  error: '#ff8b8b',
  warning: '#f5b454',
  tint: 'rgba(124, 92, 255, 0.14)',
  tintStrong: 'rgba(124, 92, 255, 0.28)',
  successBg: '#10281f',
  errorBg: '#2b1722',
  warningBg: '#2b2314',
  infoBg: '#1f1a44',
  overlay: 'rgba(11, 10, 18, 0.72)',
};

/** The colours of a mode. */
export function colorsOf(mode: ThemeMode): Colors {
  return mode === 'dark' ? DARK : LIGHT;
}

/**
 * The header band and the top bar are dark in both modes. These are the
 * colours of the text and controls on them. Text and the selected-tab
 * indicator reach their contrast (4.5:1 and 3:1) on `background`.
 */
export const BAND = {
  background: '#141026',
  text: '#f5f3ee',
  textMuted: '#c9c2e0',
  link: '#c4b2ff',
  /** The hairline under the top bar and under the tabs. */
  divider: '#2a2450',
} as const;

/** The font of the page text. Self-hosted by `fonts.ts`. */
export const FONT_TEXT =
  "Outfit, system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif";
/** The font of code and small labels. Self-hosted by `fonts.ts`. */
export const FONT_CODE =
  "'JetBrains Mono', ui-monospace, Menlo, Consolas, monospace";

/** The corner radius of cards and panels, of controls, and of small parts. */
export const RADIUS = { card: '12px', control: '10px', small: '8px' } as const;

/** The logo of the top bar: a violet square with a white K. */
export const LOGO_DATA_URI = `data:image/svg+xml;utf8,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">' +
    '<rect width="30" height="30" rx="9" fill="#7c5cff"/>' +
    '<path d="M10 7v16M10 15.5 19 7M13.5 13l6.5 10" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>' +
    '<rect x="22" y="20" width="6" height="8" rx="2" fill="#3ddc97"/>' +
    '</svg>',
)}`;

type Tokens = Theme['tokens'];

// A token that has one value in light mode and one in dark mode.
function perMode(pick: (colors: Colors) => string) {
  return { light: pick(LIGHT), dark: pick(DARK) };
}

function backgroundTokens(): Tokens {
  return {
    colorBackgroundLayoutMain: perMode((c) => c.bg),
    colorBackgroundContainerContent: perMode((c) => c.surface),
    colorBackgroundContainerHeader: perMode((c) => c.surface),
    colorBackgroundLayoutPanelContent: perMode((c) => c.surface),
    colorBackgroundPopover: perMode((c) => c.surfaceAlt),
    colorBackgroundDropdownItemDefault: perMode((c) => c.surfaceAlt),
    colorBackgroundDropdownItemHover: perMode((c) => c.tint),
    colorBackgroundDropdownItemSelected: perMode((c) => c.tintStrong),
    colorBackgroundInputDefault: perMode((c) => c.field),
    colorBackgroundControlDefault: perMode((c) => c.field),
    colorBackgroundControlChecked: perMode((c) => c.fill),
    colorBackgroundItemSelected: perMode((c) => c.tintStrong),
    colorBackgroundCellShaded: perMode((c) => c.surfaceAlt),
    colorBackgroundToggleDefault: perMode((c) => c.control),
    colorBackgroundHomeHeader: BAND.background,
    colorBackgroundStatusError: perMode((c) => c.errorBg),
    colorBackgroundStatusInfo: perMode((c) => c.infoBg),
    colorBackgroundStatusSuccess: perMode((c) => c.successBg),
    colorBackgroundStatusWarning: perMode((c) => c.warningBg),
  };
}

function buttonTokens(): Tokens {
  return {
    colorBackgroundButtonNormalDefault: 'transparent',
    colorBackgroundButtonNormalHover: perMode((c) => c.tint),
    colorBackgroundButtonNormalActive: perMode((c) => c.tintStrong),
    colorBackgroundButtonPrimaryDefault: perMode((c) => c.fill),
    colorBackgroundButtonPrimaryHover: perMode((c) => c.fillHover),
    colorBackgroundButtonPrimaryActive: perMode((c) => c.fillActive),
    colorBackgroundButtonLinkHover: perMode((c) => c.tint),
    colorBackgroundButtonLinkActive: perMode((c) => c.tintStrong),
    colorTextButtonNormalDefault: perMode((c) => c.link),
    colorTextButtonNormalHover: perMode((c) => c.linkHover),
    colorTextButtonNormalActive: perMode((c) => c.linkHover),
    colorTextButtonPrimaryDefault: '#ffffff',
    colorTextButtonPrimaryHover: '#ffffff',
    colorTextButtonPrimaryActive: '#ffffff',
    colorTextButtonInlineIconDefault: perMode((c) => c.link),
    colorTextButtonInlineIconHover: perMode((c) => c.linkHover),
    colorBorderButtonNormalDefault: perMode((c) => c.link),
    colorBorderButtonNormalHover: perMode((c) => c.linkHover),
    colorBorderButtonNormalActive: perMode((c) => c.linkHover),
  };
}

function textTokens(): Tokens {
  return {
    colorTextBodyDefault: perMode((c) => c.text),
    colorTextBodySecondary: perMode((c) => c.textMuted),
    colorTextHeadingDefault: perMode((c) => c.text),
    colorTextHeadingSecondary: perMode((c) => c.textMuted),
    colorTextLabel: perMode((c) => c.text),
    colorTextFormLabel: perMode((c) => c.text),
    colorTextFormDefault: perMode((c) => c.text),
    colorTextFormSecondary: perMode((c) => c.textMuted),
    colorTextEmpty: perMode((c) => c.textMuted),
    colorTextAccent: perMode((c) => c.link),
    colorTextLinkDefault: perMode((c) => c.link),
    colorTextLinkHover: perMode((c) => c.linkHover),
    colorTextInteractiveDefault: perMode((c) => c.textMuted),
    colorTextInteractiveHover: perMode((c) => c.text),
    colorTextInteractiveActive: perMode((c) => c.text),
    colorTextInputPlaceholder: perMode((c) => c.textMuted),
    colorTextStatusError: perMode((c) => c.error),
    colorTextStatusInfo: perMode((c) => c.link),
    colorTextStatusSuccess: perMode((c) => c.success),
    colorTextStatusWarning: perMode((c) => c.warning),
    colorTextStatusInactive: perMode((c) => c.textMuted),
    colorTextDropdownItemDefault: perMode((c) => c.text),
    colorTextDropdownItemHighlighted: perMode((c) => c.text),
    colorTextDropdownItemSecondary: perMode((c) => c.textMuted),
    colorTextGroupLabel: perMode((c) => c.textMuted),
    colorTextHomeHeaderDefault: BAND.text,
    colorTextHomeHeaderSecondary: BAND.textMuted,
    colorTextBreadcrumbCurrent: perMode((c) => c.textMuted),
    colorTextBreadcrumbIcon: perMode((c) => c.textMuted),
  };
}

function borderTokens(): Tokens {
  return {
    colorBorderDividerDefault: perMode((c) => c.border),
    colorBorderDividerSecondary: perMode((c) => c.border),
    colorBorderContainerTop: perMode((c) => c.border),
    colorBorderLayout: perMode((c) => c.border),
    colorBorderInputDefault: perMode((c) => c.control),
    colorBorderInputFocused: perMode((c) => c.link),
    colorBorderControlDefault: perMode((c) => c.control),
    colorBorderDropdownContainer: perMode((c) => c.borderStrong),
    colorBorderDropdownItemFocused: perMode((c) => c.link),
    colorBorderItemFocused: perMode((c) => c.link),
    colorBorderItemSelected: perMode((c) => c.link),
    colorBorderPopover: perMode((c) => c.borderStrong),
    colorBorderStatusError: perMode((c) => c.error),
    colorBorderStatusInfo: perMode((c) => c.link),
    colorBorderStatusSuccess: perMode((c) => c.success),
    colorBorderStatusWarning: perMode((c) => c.warning),
  };
}

function shapeTokens(): Tokens {
  const { card, control, small } = RADIUS;
  return {
    borderRadiusButton: control,
    borderRadiusInput: control,
    borderRadiusContainer: card,
    borderRadiusDropdown: card,
    borderRadiusPopover: card,
    borderRadiusAlert: card,
    borderRadiusFlashbar: card,
    borderRadiusBadge: small,
    borderRadiusToken: small,
    borderRadiusItem: small,
    borderRadiusTabsFocusRing: small,
    fontFamilyBase: FONT_TEXT,
    fontFamilyHeading: FONT_TEXT,
    fontFamilyDisplay: FONT_TEXT,
    fontFamilyMonospace: FONT_CODE,
  };
}

// Inside the dark band the global text and border colours do not apply, so
// the same roles are set again here. Cloudscape reads these in the page
// header, which holds the breadcrumbs and the title.
function headerBandTokens(): Tokens {
  return {
    colorTextAccent: BAND.link,
    colorTextLinkDefault: BAND.link,
    colorTextLinkHover: '#ffffff',
    colorTextBodySecondary: BAND.textMuted,
    colorTextBreadcrumbCurrent: BAND.textMuted,
    colorTextBreadcrumbIcon: BAND.textMuted,
    colorTextInteractiveDefault: BAND.textMuted,
    colorTextInteractiveHover: '#ffffff',
    colorTextInteractiveActive: '#ffffff',
    colorBorderItemFocused: BAND.link,
  };
}

/**
 * The Cloudscape theme of the page, for `applyTheme`: colours, fonts and
 * corner radii, with a value for each mode. `applyMode` picks the mode.
 */
export const APP_THEME: Theme = {
  tokens: {
    ...backgroundTokens(),
    ...buttonTokens(),
    ...textTokens(),
    ...borderTokens(),
    ...shapeTokens(),
  },
  contexts: {
    header: {
      tokens: {
        ...headerBandTokens(),
        colorBackgroundLayoutMain: BAND.background,
      },
    },
    'top-navigation': {
      tokens: {
        ...headerBandTokens(),
        colorBackgroundContainerContent: BAND.background,
        colorTextHeadingDefault: BAND.text,
        colorTextTopNavigationTitle: BAND.text,
        colorTextInteractiveDefault: BAND.text,
        colorTextInteractiveHover: '#ffffff',
        colorBorderDividerDefault: BAND.divider,
      },
    },
  },
};

/**
 * The same roles for the strip of the Designer and Execution tabs, which is
 * page content that sits on the band, so the header context does not reach
 * it. The selected-tab indicator is set too.
 */
export const TAB_STRIP_THEME: Theme = {
  tokens: {
    ...headerBandTokens(),
    colorBorderItemSelected: BAND.link,
  },
};

/**
 * The `style` of the page tabs: the line between two tabs, in the colour of
 * the other hairlines of the band. (The rule under the strip is set in
 * `chrome.css`.)
 */
export const TAB_STRIP_STYLE = {
  tabSeparator: { color: BAND.divider },
} as const;
