/**
 * PoolGuard motion tokens. One vocabulary for every animated surface so buttons,
 * cards, dialogs and pages move the same way.
 *
 * - Feedback (press, hover, focus): 100–200 ms.
 * - Layout and reveals: 250–400 ms.
 * - Interactive pieces use springs; content reveals use easing curves.
 */
export const duration = {
  instant: 0.1,
  fast: 0.16,
  base: 0.24,
  slow: 0.38,
} as const;

/** Calm deceleration used for most reveals. */
export const ease = [0.22, 1, 0.36, 1] as const;

export const spring = {
  /** Buttons, toggles, chips: quick and firm. */
  snappy: { type: "spring", stiffness: 520, damping: 34, mass: 0.7 },
  /** Cards, panels, layout moves. */
  gentle: { type: "spring", stiffness: 260, damping: 30, mass: 0.9 },
  /** Gliding indicators (tabs, steppers). */
  glide: { type: "spring", stiffness: 380, damping: 36 },
} as const;

/** Stagger children reveals. */
export const stagger = (step = 0.06, delay = 0) => ({
  hidden: {},
  show: { transition: { staggerChildren: step, delayChildren: delay } },
});

export const rise = {
  hidden: { opacity: 0, y: 10 },
  show: { opacity: 1, y: 0, transition: { duration: duration.slow, ease } },
};

export const fade = {
  hidden: { opacity: 0 },
  show: { opacity: 1, transition: { duration: duration.base, ease } },
};
