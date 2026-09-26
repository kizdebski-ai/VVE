// Input Style (Pilot): two named smoothing profiles shown in Polish.
// `mouse` is Mysz (strong smoothing). `pen` is Pióro (pressure-preserving).
// Auto-selection may pick an initial profile from pointer type; a manual
// override persists across reloads on this device.

export type InputProfile = 'mouse' | 'pen';

export type PointerKind = 'mouse' | 'pen' | 'touch' | 'unknown';

export const INPUT_STYLE_STORAGE_KEY = 'vve.inputStyle.v1';

export const INPUT_STYLE_LABELS: Record<InputProfile, string> = {
  mouse: 'Mysz',
  pen: 'Pióro'
};

export interface InputStyleState {
  profile: InputProfile;
  overridden: boolean;
}

export interface InputStyleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const isProfile = (value: unknown): value is InputProfile =>
  value === 'mouse' || value === 'pen';

export const defaultInputStyle = (): InputStyleState => ({
  profile: 'mouse',
  overridden: false
});

export const loadInputStyle = (
  storage?: InputStyleStorage | null
): InputStyleState => {
  if (!storage) return defaultInputStyle();
  try {
    const raw = storage.getItem(INPUT_STYLE_STORAGE_KEY);
    if (!raw) return defaultInputStyle();
    const parsed = JSON.parse(raw) as { profile?: unknown; overridden?: unknown };
    if (!isProfile(parsed.profile)) return defaultInputStyle();
    return {
      profile: parsed.profile,
      overridden: parsed.overridden === true
    };
  } catch {
    return defaultInputStyle();
  }
};

export const saveInputStyle = (
  state: InputStyleState,
  storage?: InputStyleStorage | null
): void => {
  if (!storage) return;
  try {
    storage.setItem(
      INPUT_STYLE_STORAGE_KEY,
      JSON.stringify({
        profile: state.profile,
        overridden: state.overridden === true
      })
    );
  } catch {
    // Private mode / quota: the in-memory profile still applies this session.
  }
};

/** Initial profile from pointer identity. Touch follows Mysz (finger jitter). */
export const suggestProfile = (pointerType: PointerKind): InputProfile =>
  pointerType === 'pen' ? 'pen' : 'mouse';

export const smoothingAlpha = (profile: InputProfile): number =>
  profile === 'mouse' ? 0.28 : 0.88;

export const resampleStep = (profile: InputProfile): number =>
  profile === 'mouse' ? 2.4 : 1.2;
