/** Apply prefs to the document (accent CSS var + density attribute). */
export function applyPrefs(prefs: { accent: string; density: string }) {
  document.documentElement.style.setProperty('--color-accent', prefs.accent)
  document.documentElement.style.setProperty('--color-accent-text', prefs.accent)
  document.body.dataset.density = prefs.density
}
