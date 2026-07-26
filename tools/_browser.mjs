/**
 * Shared browser launch configuration.
 *
 * PLATFORM MATTERS HERE. `--use-angle=metal` is a macOS-only backend; passing it
 * on a Linux CI runner selects a backend that does not exist. CI runners have no
 * GPU at all and fall back to SwiftShader, which is a software rasteriser and
 * therefore *more* deterministic than any real GPU — good for a self-consistency
 * gate, useless for judging real-world frame rate.
 *
 * This is also why reference PNGs are never committed: two different rasterisers
 * produce different pixels for the same scene, so a checked-in baseline would
 * false-fail everywhere except the machine that produced it. The gate captures
 * both sides fresh on whatever machine it is running on, which is portable.
 */

const isMac = process.platform === 'darwin';

/**
 * Force a software rasteriser, to reproduce CI locally.
 *
 * CI has no GPU and rasterises via SwiftShader. METHODOLOGY.md records a 20x
 * wall-clock regression that three profiler runs on this machine could not
 * see, because the structural budget counts objects rather than the cost of
 * rasterising them. A perf claim measured on a GPU is not evidence about CI.
 */
const forceSoftware = process.env.PENROSE_GL === 'swiftshader';

/** GPU backend flags, or the software rasteriser when forced. */
const glArgs = () =>
  forceSoftware ? ['--use-gl=swiftshader'] : isMac ? ['--use-angle=metal'] : [];

const COMMON = [
  '--ignore-gpu-blocklist',
  '--mute-audio',
  '--hide-scrollbars',
  '--disable-frame-rate-limit',
];

/** Args for deterministic capture. Colour profile is forced so the OS cannot shift output. */
export function captureArgs() {
  return [
    ...COMMON,
    '--force-color-profile=srgb',
    '--force-device-scale-factor=1',
    ...glArgs(),
  ];
}

/** Args for profiling. vsync off so the frame loop is not clamped to the display. */
export function profileArgs() {
  return [
    ...COMMON,
    '--disable-gpu-vsync',
    ...glArgs(),
  ];
}

export const platformNote = (isMac
  ? 'darwin / ANGLE-Metal'
  : `${process.platform} / default backend (SwiftShader on GPU-less CI)`
) + (forceSoftware ? ' / forced swiftshader' : '');
