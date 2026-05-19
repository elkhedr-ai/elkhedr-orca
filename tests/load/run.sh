#!/bin/bash
# Load Test Runner for Orca API
#
# Usage:
#   ./tests/load/run.sh                    # Full load test (1000 VUs)
#   ./tests/load/run.sh smoke              # Quick smoke test (10 VUs, 30s)
#   ./tests/load/run.sh medium             # Medium load (200 VUs)
#   ./tests/load/run.sh full               # Full load (1000 VUs)
#   ./tests/load/run.sh stress             # Stress test (2000 VUs)
#
# Environment variables:
#   BASE_URL   - API server URL (default: http://localhost:3000)
#   API_KEY    - API key for auth (optional)
#   TEST_USER  - Username for auto-login (default: admin)
#   TEST_PASS  - Password for auto-login (default: admin123)
#
# Prerequisites:
#   brew install k6          # macOS
#   sudo snap install k6     # Ubuntu
#   choco install k6         # Windows

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
K6_SCRIPT="${SCRIPT_DIR}/k6-script.js"
BASE_URL="${BASE_URL:-http://localhost:3000}"
MODE="${1:-full}"

# Check k6 is installed
if ! command -v k6 &>/dev/null; then
  echo "Error: k6 is not installed."
  echo "Install with:"
  echo "  brew install k6          # macOS"
  echo "  sudo snap install k6     # Ubuntu"
  echo "  choco install k6         # Windows"
  exit 1
fi

# Check server is reachable
echo "Checking server at ${BASE_URL}..."
if ! curl -sf "${BASE_URL}/health" >/dev/null 2>&1; then
  echo "Warning: Server at ${BASE_URL} is not responding."
  echo "Start the server first: npm run server"
  echo ""
  read -p "Continue anyway? (y/N) " -n 1 -r
  echo
  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
  fi
fi

# Build k6 environment args
K6_ENV_ARGS=""
if [ -n "${API_KEY:-}" ]; then
  K6_ENV_ARGS="${K6_ENV_ARGS} --env API_KEY=${API_KEY}"
fi
if [ -n "${TEST_USER:-}" ]; then
  K6_ENV_ARGS="${K6_ENV_ARGS} --env TEST_USER=${TEST_USER}"
fi
if [ -n "${TEST_PASS:-}" ]; then
  K6_ENV_ARGS="${K6_ENV_ARGS} --env TEST_PASS=${TEST_PASS}"
fi
K6_ENV_ARGS="${K6_ENV_ARGS} --env BASE_URL=${BASE_URL}"

# Run based on mode
case "${MODE}" in
  smoke)
    echo "Running smoke test (10 VUs, 30s)..."
    k6 run \
      ${K6_ENV_ARGS} \
      --out json="${SCRIPT_DIR}/results-smoke.json" \
      --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
      -e SCENARIO=health_smoke \
      "${K6_SCRIPT}"
    ;;

  medium)
    echo "Running medium load test (200 VUs peak)..."
    k6 run \
      ${K6_ENV_ARGS} \
      --out json="${SCRIPT_DIR}/results-medium.json" \
      --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
      "${K6_SCRIPT}"
    ;;

  full)
    echo "Running full load test (1000 VUs peak)..."
    k6 run \
      ${K6_ENV_ARGS} \
      --out json="${SCRIPT_DIR}/results-full.json" \
      --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
      "${K6_SCRIPT}"
    ;;

  stress)
    echo "Running stress test (2000 VUs peak)..."
    k6 run \
      ${K6_ENV_ARGS} \
      --out json="${SCRIPT_DIR}/results-stress.json" \
      --summary-trend-stats="avg,min,med,max,p(90),p(95),p(99)" \
      --vus 2000 \
      --duration 3m \
      "${K6_SCRIPT}"
    ;;

  *)
    echo "Unknown mode: ${MODE}"
    echo "Usage: $0 [smoke|medium|full|stress]"
    exit 1
    ;;
esac

echo ""
echo "Results saved to ${SCRIPT_DIR}/results-${MODE}.json"
