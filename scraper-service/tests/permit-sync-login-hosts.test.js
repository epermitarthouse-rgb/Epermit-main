"use strict";

const { test } = require("node:test");
const assert = require("node:assert/strict");

const safety = require("../permit-sync/core/safety");
const live = require("../permit-sync/adapters/dc-projectdox/live-transport");

const MIDDLEWARE = "avolvecspiam-as-authmiddleware.azurewebsites.net";
const BLOB = "avolvecspiamsa.blob.core.windows.net";

// D-046: the login phase no longer filters hosts (it follows the same redirects as the existing DC
// scraper). The two Avolve hosts stay recorded in LOGIN_EXTRA_HOSTS, where classifyLoginPage uses them,
// and the read phase must not have gained them.

test("the Avolve login host table is unchanged: exactly two exact hostnames", () => {
  assert.deepEqual(Object.keys(safety.LOGIN_EXTRA_HOSTS).sort(), [MIDDLEWARE, BLOB].sort());
  assert.equal(safety.isLoginIdpHost(MIDDLEWARE), true);
  assert.equal(safety.isLoginIdpHost(BLOB), false);
  for (const host of [`evil-${BLOB}`, `${BLOB}.attacker.com`, "evil.azurewebsites.net", `${MIDDLEWARE}.evil.test`]) {
    assert.equal(safety.isLoginIdpHost(host), false, host);
    assert.equal(safety.evaluateLoginExtraHost("GET", host), null, host);
  }
  assert.equal(safety.evaluateLoginExtraHost("POST", BLOB).allowed, false);
});

test("a password form on the middleware host counts as a login form; the blob host never does", () => {
  const c = (host, hasPasswordField) => live.classifyLoginPage({ url: `https://${host}/signin`, text: "Sign in", hasPasswordField });
  assert.equal(c(MIDDLEWARE, true), "login_form");
  assert.equal(c(MIDDLEWARE, false), "unknown");
  assert.equal(live.classifyLoginPage({ url: `https://${MIDDLEWARE}/x`, text: "Enter the verification code" }), "mfa");
  assert.equal(c(BLOB, false), "unknown");
  assert.equal(c("evil.azurewebsites.net", false), "unknown");
});

test("the DC read phase does not gain the login hosts", () => {
  for (const host of [MIDDLEWARE, BLOB]) {
    assert.equal(safety.DC_HOSTS.includes(host), false);
    assert.equal(safety.evaluateRequest({ method: "GET", url: `https://${host}/` }).allowed, false);
    assert.equal(safety.evaluateRequest({ method: "GET", url: `https://${host}/` }).rule, "host");
    const guard = safety.createRunGuard();
    assert.equal(guard.checkRequest("GET", `https://${host}/Folder/GetProjectFolders`).allowed, false);
    for (const t of ["document", "xhr", "fetch"]) {
      for (const m of ["GET", "POST"]) {
        const d = live.routeReadRequest({ method: m, url: `https://${host}/x`, resourceType: t }, safety.createRunGuard());
        assert.equal(d.action, "abort", `${m} ${t} ${host}`);
      }
    }
    assert.equal(safety.evaluateClick({ tag: "a", href: `https://${host}/` }).allowed, false);
  }
});
