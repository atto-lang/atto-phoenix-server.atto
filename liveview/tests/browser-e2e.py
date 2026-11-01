"""Optional Chromium E2E for the Node reference server (NOT native Oreslang).

Run in a network-permitted environment after installing Python Playwright:
  python -m playwright install chromium
  python tests/browser-e2e.py
"""
import os
import subprocess
from pathlib import Path
from playwright.sync_api import sync_playwright, expect

ROOT = Path(__file__).resolve().parents[1]
process = subprocess.Popen(
    ['node', str(ROOT / 'reference/demo-server.mjs')],
    cwd=ROOT, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True,
)
try:
    line = process.stdout.readline().strip()
    if not line.startswith('HOST_REFERENCE_ONLY http://127.0.0.1:'):
        raise RuntimeError('reference server failed to start: ' + line)
    origin = line.split(' ', 1)[1]
    with sync_playwright() as pw:
        options = {'headless': True}
        if os.getenv('CHROMIUM_PATH'):
            options['executable_path'] = os.environ['CHROMIUM_PATH']
        browser = pw.chromium.launch(**options)
        try:
            context = browser.new_context()
            a = context.new_page()
            b = context.new_page()
            failures = []
            for page in (a, b):
                page.on('pageerror', lambda e: failures.append(str(e)))
                page.goto(origin)
                expect(page.locator('#count_value')).to_have_text('0', timeout=10000)
            a.locator('#increment_button').click()
            expect(a.locator('#count_value')).to_have_text('1')
            expect(b.locator('#count_value')).to_have_text('1')
            b.locator('#increment_button').click()
            expect(a.locator('#count_value')).to_have_text('2')
            expect(b.locator('#count_value')).to_have_text('2')
            a.reload()
            expect(a.locator('#count_value')).to_have_text('2')
            a.locator('#decrement_button').click()
            expect(b.locator('#count_value')).to_have_text('1')
            assert not failures, failures
            print('BROWSER_E2E_PASS: 2 clients + mutations + broadcast + reload')
        finally:
            browser.close()
finally:
    process.terminate()
    try:
        process.wait(timeout=5)
    except subprocess.TimeoutExpired:
        process.kill()
        process.wait(timeout=5)
