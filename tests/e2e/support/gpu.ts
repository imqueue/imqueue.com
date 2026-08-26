// gpu.ts — keep the test browser on the INTEGRATED GPU, and off the discrete one.
//
// Why this file exists: three hard freezes of this workstation, each one ending
// with the kernel powering the discrete NVIDIA GPU back up —
//
//   kernel: nvidia 0000:02:00.0: Enabling HDA controller     <- last line before the hang
//
// — and nothing else: no OOM kill, no panic, no vmcore with kdump armed. The dGPU
// sits in runtime suspend (`power/control=auto`, suspended for ~all of uptime) and
// the resume path out of it is what wedges the machine. Chromium ENUMERATES GPUs at
// startup, which is enough to trigger that resume even when it renders nothing on
// it — so "we passed --disable-gpu" is not a defence.
//
// The defence is to make the discrete GPU UNFINDABLE by the browser process:
//
//   * glvnd is given one EGL vendor file — Mesa's — so NVIDIA's EGL library is
//     never dlopened. That dlopen is itself a device touch.
//   * The Vulkan loader is given the integrated card's ICD only, so the NVIDIA ICD
//     is never loaded either. `__VK_LAYER_NV_optimus=non_NVIDIA_only` is NVIDIA's
//     own switch for the same thing, set as well because it costs nothing.
//   * GLX is pointed at Mesa, PRIME render offload is explicitly off, and Mesa is
//     told WHICH card by PCI address rather than by index — on this machine the
//     dGPU is renderD128 and the iGPU renderD129, so `DRI_PRIME=0` would have
//     selected exactly the wrong one.
//
// Everything is DISCOVERED, never hard-coded: the integrated card is "the DRM card
// whose driver is not nvidia/nouveau", and a vendor file that is not installed is
// left out rather than pointed at. On a machine with no discrete GPU this all
// degrades to a couple of harmless variables.

import fs from 'node:fs';
import path from 'node:path';

const DISCRETE_DRIVERS = /^(nvidia|nouveau)$/;

/** One DRM card as /sys describes it. */
interface Card {
  card: string;
  driver: string;
  slot: string;
}

/** Environment variables handed to the browser process. */
type GpuEnv = Record<string, string>;

const readFirst = (...files: string[]): string | null =>
  files.find((file) => fs.existsSync(file)) || null;

/** Every DRM card, with its driver and PCI address. */
function cards(): Card[] {
  const root = '/sys/class/drm';

  if (!fs.existsSync(root)) {
    return [];
  }

  return fs
    .readdirSync(root)
    .filter((name) => /^card\d+$/.test(name))
    .map((name) => {
      let uevent = '';

      try {
        uevent = fs.readFileSync(path.join(root, name, 'device', 'uevent'), 'utf8');
      } catch {
        return null;
      }

      const driver = /^DRIVER=(.*)$/m.exec(uevent);
      const slot = /^PCI_SLOT_NAME=(.*)$/m.exec(uevent);

      return {
        card: name,
        driver: driver?.[1] ?? '',
        slot: slot?.[1] ?? '',
      };
    })
    .filter((card) => card !== null);
}

/** The card to render on: the first that is not a discrete NVIDIA/nouveau one. */
function integrated(): Card | null {
  return cards().find((card) => card.driver && !DISCRETE_DRIVERS.test(card.driver)) || null;
}

/** The cards we are trying to keep asleep, for the runtime-status check below. */
function discrete(): Card[] {
  return cards().filter((card) => DISCRETE_DRIVERS.test(card.driver));
}

/** Mesa spells a PCI selector `pci-0000_00_02_0`. */
const priTag = (slot: string): string => `pci-${slot.replace(/[:.]/g, '_')}`;

/** The Vulkan ICD for a DRM driver, when we can name it; otherwise null. */
function icdFor(driver: string): string | null {
  const dir = '/usr/share/vulkan/icd.d';
  const byDriver: Record<string, string[] | undefined> = {
    i915: ['intel_icd.json', 'intel_icd.x86_64.json'],
    xe: ['intel_icd.json', 'intel_icd.x86_64.json'],
    amdgpu: ['radeon_icd.json', 'radeon_icd.x86_64.json'],
  };
  const names = byDriver[driver];

  if (!names) {
    return null;
  }

  return readFirst(...names.map((name) => path.join(dir, name)));
}

/** Every installed ICD that is not a discrete-GPU one — the fallback. */
function nonDiscreteIcds(): string[] {
  const dir = '/usr/share/vulkan/icd.d';

  if (!fs.existsSync(dir)) {
    return [];
  }

  return fs
    .readdirSync(dir)
    .filter((name: string) => name.endsWith('.json') && !/nvidia|nouveau/.test(name))
    .map((name: string) => path.join(dir, name));
}

/**
 * Environment for a browser process that must not touch the discrete GPU.
 *
 * `software: true` additionally forces llvmpipe — right for the headless default,
 * wrong for a headed run, where the whole point is to render on the integrated
 * card rather than on the CPU.
 */
function gpuEnv({ software = false }: { software?: boolean } = {}): GpuEnv {
  const env: GpuEnv = {
    // Never hand work to the discrete card, whatever else is configured.
    __NV_PRIME_RENDER_OFFLOAD: '0',
    __GLX_VENDOR_LIBRARY_NAME: 'mesa',
    // NVIDIA's own switch: its Vulkan ICD reports no devices when this is set.
    __VK_LAYER_NV_optimus: 'non_NVIDIA_only',
  };

  const mesaEgl = readFirst('/usr/share/glvnd/egl_vendor.d/50_mesa.json');

  if (mesaEgl) {
    env.__EGL_VENDOR_LIBRARY_FILENAMES = mesaEgl;
  }

  const card = integrated();

  if (card && card.slot) {
    // By PCI address, not by index: the dGPU is renderD128 and the iGPU renderD129
    // on this machine, so an index would pick the wrong one.
    env.DRI_PRIME = priTag(card.slot);
  }

  // Called once and reused: `icdFor` hits the filesystem, and the old
  // `x ? [f(x)] : y` spelling called it twice on every hit.
  const own = card ? icdFor(card.driver) : null;
  const icds = own ? [own] : nonDiscreteIcds();

  if (icds.length) {
    // VK_DRIVER_FILES is the current name; VK_ICD_FILENAMES is what older loaders
    // read. Both, because which one is in use is a property of the machine.
    env.VK_DRIVER_FILES = icds.join(':');
    env.VK_ICD_FILENAMES = icds.join(':');
  }

  if (software) {
    env.LIBGL_ALWAYS_SOFTWARE = '1';
  }

  return env;
}

/**
 * The /dev/dri nodes belonging to one card, resolved through by-path.
 *
 * by-path is keyed by PCI address, which is the only stable name here: the
 * discrete card is renderD128 and the integrated one renderD129 on this machine,
 * i.e. the numbering follows enumeration order and says nothing about which is
 * which.
 */
function nodesFor(card: Card | null): string[] {
  if (!card || !card.slot) {
    return [];
  }

  const dir = '/dev/dri/by-path';

  return ['card', 'render']
    .map((kind) => path.join(dir, `pci-${card.slot}-${kind}`))
    .filter((link) => fs.existsSync(link))
    .map((link) => fs.realpathSync(link));
}

/** The DRM device nodes a browser is allowed to see. */
const integratedNodes = () => nodesFor(integrated());

/** The DRM device nodes that must stay untouched. */
const discreteNodes = () => discrete().flatMap(nodesFor);

/** Is each discrete GPU still runtime-suspended? Used to PROVE nothing woke it. */
function discreteStatus(): (Card & { status: string })[] {
  return discrete().map((card) => {
    const file = `/sys/bus/pci/devices/${card.slot}/power/runtime_status`;
    let status = 'unknown';

    try {
      status = fs.readFileSync(file, 'utf8').trim();
    } catch {
      /* not every card exposes runtime PM */
    }

    return { ...card, status };
  });
}

/** One line for the console, so a run says which card it pinned itself to. */
function describe(): string {
  const card = integrated();
  const asleep = discreteStatus()
    .map((c) => `${c.driver}@${c.slot}=${c.status}`)
    .join(' ');

  return [
    card ? `render on ${card.driver}@${card.slot} (${card.card})` : 'no integrated card found',
    asleep ? `| discrete: ${asleep}` : '| no discrete card',
  ].join(' ');
}

export {
  gpuEnv,
  integrated,
  discrete,
  integratedNodes,
  discreteNodes,
  discreteStatus,
  describe,
};
