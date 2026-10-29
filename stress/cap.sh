#!/bin/bash
# Stepped capacity test for Tenet Meet's media server (LiveKit).
# Each step = a meeting of N people: N send video + audio, N receive (grid view), for 2 minutes,
# then 1 minute of rest. Rooms are throw-away test rooms; Tenet Meet's own meetings are not touched.
# Needs: lk (LiveKit CLI) and LIVEKIT_API_KEY / LIVEKIT_API_SECRET in the environment (never in a file).
# Usage: STEPS="4 8 12" bash stress/cap.sh        (Ctrl+C stops at any time)
set -u
export LIVEKIT_URL=${LIVEKIT_URL:-wss://meet.tenetnetworks.com/media}
: "${LIVEKIT_API_KEY:?set LIVEKIT_API_KEY first}"; : "${LIVEKIT_API_SECRET:?set LIVEKIT_API_SECRET first}"
OUT=$(dirname "$0")/results/cap-$(date +%F-%H%M); mkdir -p "$OUT"
echo "results in $OUT"
for N in ${STEPS:-4 8 12}; do
  if   [ "$N" -le 9 ];  then LAYOUT=3x3
  elif [ "$N" -le 16 ]; then LAYOUT=4x4
  else LAYOUT=5x5; fi
  echo "=== $(date +%T)  step: $N people, layout $LAYOUT ===" | tee -a "$OUT/summary.txt"
  lk load-test --room "captest-$N-$(date +%s)" \
     --video-publishers "$N" --audio-publishers "$N" --subscribers "$N" \
     --video-resolution medium --layout "$LAYOUT" --simulate-speakers \
     --num-per-second 2 --duration 2m > "$OUT/step-$N.log" 2>&1
  tail -40 "$OUT/step-$N.log" >> "$OUT/summary.txt"
  echo "=== $(date +%T)  step $N done; resting 60 s ===" | tee -a "$OUT/summary.txt"
  sleep 60
done
echo "finished: $OUT/summary.txt"
