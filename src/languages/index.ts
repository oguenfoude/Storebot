import en from "./en";
import ar from "./ar";
import fr from "./fr";

export type Language = {
  general: Record<string, string>;
  buttons: Record<string, string>;
  help: Record<string, string>;
  start: Record<string, string>;
  menu: Record<string, string>;
  balance: Record<string, string>;
  products: Record<string, string>;
  buy: Record<string, string>;
  support: Record<string, string>;
  account: Record<string, string>;
  admin: Record<string, string>;
  preorder: Record<string, string>;
  messages: Record<string, string>;
  adminPanel: Record<string, string>;
  sellerKeyboard: Record<string, string>;
};

const languages: Record<string, Language> = { en, ar, fr };

let currentLanguage: string = process.env.BOT_LANGUAGE || "en";

export function setLanguage(lang: string): void {
  if (!languages[lang]) {
    throw new Error(`Language "${lang}" not supported. Available: ${Object.keys(languages).join(", ")}`);
  }
  currentLanguage = lang;
}

export function getLanguage(): string {
  return currentLanguage;
}

export function t(lang?: string): Language {
  if (lang && languages[lang]) return languages[lang];
  return languages[currentLanguage] || languages.en;
}

export function template(str: string, vars: Record<string, string | number>): string {
  return str.replace(/\$\{(\w+)\}/g, (_, key) => {
    return key in vars ? String(vars[key]) : `\${${key}}`;
  });
}

export { en, ar, fr };
