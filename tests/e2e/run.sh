#!/usr/bin/env bash
# run.sh — run the end-to-end suite inside a resource cap it cannot escape.
#
#   tests/e2e/run.sh                       # whole suite
#   tests/e2e/run.sh --project=desktop
#   tests/e2e/run.sh specs/search-dialog.spec.js
#
# Three runs of this suite froze this workstation hard enough to need a power
# cycle. The cause was the browser reaching the NVIDIA driver (see the header of
# playwright.config.js, which is where that is dealt with). This file is the
# containment that does not depend on having diagnosed it correctly:
#
#   * strays from an interrupted run are reaped BEFORE anything new is started;
#   * the run goes in a transient cgroup with a memory ceiling, a CPU quota and a
#     task cap, so a browser that goes wrong is killed by the kernel rather than
#     taking the desktop with it;
#   * it is niced, so a full-tilt run never outranks the desktop for CPU;
#   * and strays are reaped again on the way out, including after a Ctrl-C.
#
# The caps are generous for the work (two Chromiums and a static file server) and
# small next to the machine. Raise them with E2E_MEMORY_MAX / E2E_CPU_QUOTA.

set -u

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "${HERE}/../.." && pwd)"

MEMORY_MAX="${E2E_MEMORY_MAX:-6G}"
CPU_QUOTA="${E2E_CPU_QUOTA:-400%}"
TASKS_MAX="${E2E_TASKS_MAX:-512}"

reap() { node "${HERE}/support/reap.js"; }

# Before, so a previous run's leftovers are not counted against this run's caps —
# and again on the way out, however this exits.
reap
trap reap EXIT INT TERM

cd "${ROOT}" || exit 1

PLAYWRIGHT=(npx playwright test -c "${HERE}/playwright.config.js" "$@")

# ---- containment ----------------------------------------------------------
#
# Running this suite took this workstation down four times on 2026-08-25. The
# fourth one panicked with kdump armed, and the trace named the cause outright:
#
#   Oops: Split lock detected
#   CPU: 5 PID: 648 Comm: systemd-resolve
#   RIP: skb_clone+0x159/0x1e0        <-  f0 ff 42 20  =  lock incl 0x20(%rdx)
#   RDX: ffff893b5292699e             <-  not 4-byte aligned
#
# systemd-resolved sent a DNS query; the packet was delivered locally; a bound RAW
# socket wanted a copy; raw_v4_input() called skb_clone(), which does an atomic
# increment of the skb's dataref — on a misaligned address. The CPU raised #AC,
# and this kernel's policy is "crashing the kernel on kernel split_locks". The
# machine dies.
#
# None of that is ours. The crashing process is systemd-resolved, the trigger is
# a DNS lookup, and there is not one GPU or browser frame in the trace. What a
# test run contributes is VOLUME: more packets through that path is more chances
# to land on the misaligned skb. The real fix is `split_lock_detect=off` on the
# kernel command line, which is the machine owner's to make and needs a reboot.
#
# So the isolation below is a mitigation, not a fix:
#
# 1. THE NETWORK, isolated by default. Every byte the suite moves is 127.0.0.1 —
#    the server is local, and every external host is intercepted in-process by
#    support/fixtures.js and answered without a socket. A namespace with nothing
#    but loopback therefore costs the suite nothing, keeps its traffic off the
#    host's nftables/WireGuard/Docker path, and makes "nothing leaves this
#    machine" a property of the kernel rather than a promise made by fixtures.
#    E2E_HOST_NET=1 opts out.
#
# 2. THE DISCRETE GPU's device nodes, opt-in via E2E_HIDE_DGPU=1. The first three
#    freezes captured nothing and each ended on `nvidia … Enabling HDA
#    controller`, which is what originally pointed at the dGPU's resume path.
#    That inference did not survive: the one crash that recorded a trace was this
#    one, the GPU pinning in support/gpu.js is verified working (the card stayed
#    `suspended` through every run) and the machine panicked anyway. All four were
#    most likely this same bug, with that nvidia line simply the last message
#    journald managed to flush. The pinning stays — it is free and correct — but
#    hiding the nodes is more than the evidence supports.
if command -v bwrap >/dev/null 2>&1; then
  BWRAP=(bwrap --dev-bind / / --die-with-parent)

  if [ "${E2E_HOST_NET:-0}" != "1" ]; then
    # bwrap brings loopback up inside the new namespace, which is all the suite
    # needs. Verified: the server answers and external egress is impossible.
    BWRAP+=(--unshare-net)
    echo "e2e: network isolated — loopback only"
  else
    echo "e2e: E2E_HOST_NET=1 — using the host network stack." >&2
  fi

  if [ "${E2E_HIDE_DGPU:-0}" = "1" ]; then
    mapfile -t ALLOWED < <(node -e \
      'require("'"${HERE}"'/support/gpu.js").integratedNodes().forEach((n) => console.log(n))')

    if [ "${#ALLOWED[@]}" -gt 0 ]; then
      BWRAP+=(--tmpfs /dev/dri)

      for node in "${ALLOWED[@]}"; do
        BWRAP+=(--dev-bind "${node}" "${node}")
      done

      echo "e2e: /dev/dri restricted to ${ALLOWED[*]}"
    else
      echo "e2e: no integrated DRM nodes found — not restricting /dev/dri." >&2
    fi
  fi

  PLAYWRIGHT=("${BWRAP[@]}" -- "${PLAYWRIGHT[@]}")
else
  echo "e2e: bwrap is not installed — running WITHOUT network isolation." >&2
fi

if command -v systemd-run >/dev/null 2>&1 &&
   systemd-run --user --scope --quiet -p MemoryMax=64M true >/dev/null 2>&1; then
  echo "e2e: capped at MemoryMax=${MEMORY_MAX} CPUQuota=${CPU_QUOTA} TasksMax=${TASKS_MAX}"
  systemd-run --user --scope --quiet \
    --unit="imqueue-e2e-$$" \
    -p "MemoryMax=${MEMORY_MAX}" \
    -p "MemorySwapMax=0" \
    -p "CPUQuota=${CPU_QUOTA}" \
    -p "TasksMax=${TASKS_MAX}" \
    nice -n 10 "${PLAYWRIGHT[@]}"
else
  # No usable cgroup delegation: still nice it, and say plainly that the ceiling
  # is missing rather than pretending the run is contained.
  echo "e2e: systemd-run unavailable — running niced, WITHOUT a memory ceiling." >&2
  nice -n 10 "${PLAYWRIGHT[@]}"
fi
