#!/bin/bash
cd /opt/tenet-meet-tests/media-tests
npx playwright test --config=playwright.config.js "$@"
